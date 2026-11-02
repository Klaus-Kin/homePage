import { Initialization } from "./initialization.ts";
import { computeMountain, computeMeadow } from "./terrain-compute.ts";
import type { TerrainJob } from "./terrain-worker-types.ts";

// 独立模块 Worker 无 DOM 依赖；仍按预算让出任务，接收后台暂停和下一条控制消息。
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown, transfers?: ArrayBuffer[]): void;
};
let paused = false;
worker.onmessage = async ({ data }: MessageEvent<{ id: number; job?: TerrainJob; paused?: boolean }>) => {
  if (!data.job) { paused = Boolean(data.paused); return; }
  const init = new Initialization(undefined, async () => {
    // Worker 也优先使用原生任务让出，避免 setTimeout 嵌套的最小延迟累积成新的加载等待。
    const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
    if (scheduler) await scheduler.yield();
    else await new Promise(resolve => setTimeout(resolve, 0));
    while (paused) await new Promise(resolve => setTimeout(resolve, 50));
  });
  try {
    const job = data.job;
    const result = job.type === "mountain" ? await computeMountain(job.layer, job.mobile, init) : await computeMeadow(job, init);
    const buffers = Object.values(result).filter((value): value is Float32Array | Uint16Array | Uint32Array => ArrayBuffer.isView(value))
      .map(value => value.buffer as ArrayBuffer);
    worker.postMessage({ id: data.id, result }, buffers);
  } catch (error) {
    worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  } finally { init.dispose(); }
};
