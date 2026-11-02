import type { Initialization } from "./initialization.ts";
import type { TerrainJob, MeadowJob, MountainData, MeadowData } from "./terrain-worker-types.ts";

type Pending = { resolve(value: MountainData | MeadowData): void; reject(error: unknown): void };
type Client = { worker?: Worker; next: number; pending: Map<number, Pending>; failed: boolean };
const clients = new WeakMap<Initialization, Client>();

/** 每个场景共享一个计算线程；故障只回退一次，取消则立即终止线程并拒绝所有迟到结果。 */
export function computeTerrain(job: MeadowJob, init: Initialization): Promise<MeadowData>;
export function computeTerrain(job: Extract<TerrainJob, { type: "mountain" }>, init: Initialization): Promise<MountainData>;
export async function computeTerrain(job: TerrainJob, init: Initialization): Promise<MountainData | MeadowData> {
  init.check();
  const checkpoint = init.checkpoint(); if (checkpoint) await checkpoint;
  // 地形与主线程地面可各用独立预算，但同一场景的嵌套任务仍只启动一个线程。
  const root = init.root;
  let client = clients.get(root);
  if (!client) {
    client = { next: 0, pending: new Map(), failed: false };
    clients.set(root, client);
    const current = client;
    const fail = (error: unknown) => {
      current.failed = true; current.worker?.terminate(); current.worker = undefined;
      current.pending.forEach(pending => pending.reject(error)); current.pending.clear();
    };
    const visibility = () => current.worker?.postMessage({ paused: document.hidden });
    root.cleanup(() => {
      fail(new DOMException("地形计算已取消", "AbortError"));
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
      clients.delete(root);
    });
    try {
      current.worker = new Worker(new URL("./terrain-worker.ts", import.meta.url), { type: "module" });
      current.worker.onmessage = ({ data }) => {
        const pending = current.pending.get(data.id);
        if (!pending) return;
        current.pending.delete(data.id);
        if (data.error) pending.reject(new Error(`地形计算失败：${data.error}`));
        else pending.resolve(data.result);
      };
      current.worker.onerror = event => { event.preventDefault(); fail(new Error(`地形线程不可用：${event.message}`)); };
      current.worker.onmessageerror = () => fail(new Error("地形线程数据无法解码"));
      document.addEventListener("visibilitychange", visibility); visibility();
    } catch (error) { fail(error); }
  }
  if (client.worker && !client.failed) {
    const current = client;
    let id = 0;
    try {
      const result = await init.waitFor(new Promise<MountainData | MeadowData>((resolve, reject) => {
        id = ++current.next; current.pending.set(id, { resolve, reject });
        // 输入数组仍由主场景使用，结构化克隆；输出缓冲由 Worker 转移，不保留第二份大数组。
        try { current.worker!.postMessage({ id, job }); }
        catch (error) { current.pending.delete(id); reject(error); }
      }));
      init.check(); return result;
    } catch (error) {
      init.check();
      console.warn("地形线程计算失败，改用分批生成：", error);
    } finally {
      // 单个子任务取消不终止兄弟任务；立即移除它的回调，迟到的大数组无需继续保留或交付。
      current.pending.delete(id);
    }
  }
  // 不支持 Worker 或加载失败仍使用完全相同的算法，并保留主线程的 8ms 预算和取消信号。
  const { computeMountain, computeMeadow } = await import("./terrain-compute.ts");
  init.check();
  return job.type === "mountain" ? computeMountain(job.layer, job.mobile, init) : computeMeadow(job, init);
}
