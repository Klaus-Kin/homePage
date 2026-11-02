import { diagnostics } from "../performance-policy.ts";

/** 每批最多占用约 8ms；真正切换浏览器任务，让合成、输入和超时守卫获得执行机会。 */
export class Initialization {
  readonly controller = new AbortController();
  private resources = new Set<{ dispose(): void }>();
  private cleanups = new Set<() => void>();
  private released = new WeakSet<object>();
  private started: number;
  readonly batches: number[] = [];
  readonly phases: string[] = [];
  phase = "setup";

  private now: () => number;
  private schedule: () => Promise<void>;
  private reportProgress: (phase: string) => void;
  private reportedPhase = "";
  private owner?: Initialization;
  private children: Initialization[] = [];

  constructor(now = () => performance.now(),
    schedule: () => Promise<void> = async () => {
      const scheduler = (globalThis as typeof globalThis & {
        scheduler?: { yield(): Promise<void> };
      }).scheduler;
      if (scheduler) await scheduler.yield();
      else await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }, reportProgress: (phase: string) => void = () => {}, owner?: Initialization) {
    this.now = now; this.schedule = schedule; this.started = now(); this.reportProgress = reportProgress;
    this.owner = owner;
  }

  /** 同一初始化树共享下载缓存，子任务只独立计算自己的 CPU 时间预算。 */
  get root(): Initialization { return this.owner?.root ?? this; }

  /** 仅验收读取时合并所有并行预算，嵌套子任务也不能漏出长任务统计。 */
  get stats(): { batches: number[]; phases: string[] } {
    const children = this.children.map(child => child.stats);
    return { batches: this.batches.concat(...children.map(child => child.batches)),
      phases: this.phases.concat(...children.map(child => child.phases)) };
  }

  check() { this.controller.signal.throwIfAborted(); }

  /** 并行生成使用独立 CPU 预算，共享上级资源所有权；一个任务的网络等待不抹掉另一个任务已用的时间。 */
  fork() {
    this.check();
    const child = new Initialization(this.now, this.schedule, this.reportProgress, this);
    this.children.push(child);
    this.cleanup(() => child.dispose());
    return child;
  }

  /** 未到预算时不创建微任务；调用点只在返回 Promise 时 await。 */
  checkpoint(force = false): Promise<void> | undefined {
    this.check();
    // 仅真实阶段变化才能续期启动看门狗；同一阶段反复让出任务不能掩盖卡死。
    if (this.phase !== this.reportedPhase) {
      this.reportedPhase = this.phase;
      this.reportProgress(this.phase);
    }
    const duration = this.now() - this.started;
    if (!force && duration < 8) return;
    if (diagnostics || typeof window === "undefined") {
      this.batches.push(duration);
      this.phases.push(this.phase);
    }
    return this.schedule().then(() => { this.check(); this.started = this.now(); });
  }

  /** 所有资源先登记再进入异步等待；共享纹理和几何只释放一次。 */
  track<T extends { dispose(): void }>(resource: T): T {
    if (this.controller.signal.aborted) { resource.dispose(); this.check(); }
    this.resources.add(resource);
    this.owner?.track(resource);
    return resource;
  }

  cleanup(callback: () => void) { this.cleanups.add(callback); }

  /** GPU 编译是异步等待，不把驱动轮询时间算作 CPU 批次；取消时立即结束等待并拒绝迟到结果。 */
  waitFor<T>(promise: Promise<T>): Promise<T> {
    this.check();
    // 保留等待前已经花费的 CPU 预算，只扣除异步驱动等待；立即完成的 Promise 也不能重置批次。
    const spent = this.now() - this.started;
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal;
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      promise.then(value => {
        signal.removeEventListener("abort", abort);
        if (!signal.aborted) { this.started = this.now() - spent; resolve(value); }
      }, error => { signal.removeEventListener("abort", abort); reject(error); });
    });
  }

  /** 树遍历与独立登记可能命中同一资源，统一去重后释放。 */
  release(resource: { dispose(): void }) {
    if (this.released.has(resource)) return;
    this.released.add(resource);
    this.resources.delete(resource);
    if (this.owner) this.owner.release(resource);
    else resource.dispose();
  }

  /** 纹理下载不能可靠中断时立即结束等待，并释放迟到结果。 */
  wait<T extends { dispose(): void }>(promise: Promise<T>): Promise<T> {
    this.check();
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal;
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      promise.then((value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) value.dispose();
        else { this.started = this.now(); resolve(this.track(value)); }
      }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
    });
  }

  dispose() {
    if (this.controller.signal.aborted) return;
    this.controller.abort(new DOMException("场景初始化已取消", "AbortError"));
    this.cleanups.forEach((callback) => callback());
    this.cleanups.clear();
    this.resources.forEach((resource) => this.release(resource));
    this.resources.clear();
    this.children.length = 0;
  }
}
