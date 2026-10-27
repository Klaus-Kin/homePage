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

  constructor(now = () => performance.now(),
    schedule: () => Promise<void> = async () => {
      const scheduler = (globalThis as typeof globalThis & {
        scheduler?: { yield(): Promise<void> };
      }).scheduler;
      if (scheduler) await scheduler.yield();
      else await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }) { this.now = now; this.schedule = schedule; this.started = now(); }

  check() { this.controller.signal.throwIfAborted(); }

  /** 未到预算时不创建微任务；调用点只在返回 Promise 时 await。 */
  checkpoint(force = false): Promise<void> | undefined {
    this.check();
    const duration = this.now() - this.started;
    if (!force && duration < 8) return;
    this.batches.push(duration);
    this.phases.push(this.phase);
    return this.schedule().then(() => { this.check(); this.started = this.now(); });
  }

  /** 所有资源先登记再进入异步等待；共享纹理和几何只释放一次。 */
  track<T extends { dispose(): void }>(resource: T): T {
    if (this.controller.signal.aborted) { resource.dispose(); this.check(); }
    this.resources.add(resource);
    return resource;
  }

  cleanup(callback: () => void) { this.cleanups.add(callback); }

  /** 树遍历与独立登记可能命中同一资源，统一去重后释放。 */
  release(resource: { dispose(): void }) {
    if (this.released.has(resource)) return;
    this.released.add(resource);
    this.resources.delete(resource);
    resource.dispose();
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
  }
}
