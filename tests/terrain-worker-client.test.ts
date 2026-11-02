import { test } from "node:test";
import assert from "node:assert/strict";
import { Initialization } from "../src/scene/initialization.ts";
import { computeTerrain } from "../src/scene/terrain-worker-client.ts";

// 同一线程同时服务多条生成请求，乱序返回必须按编号交付；销毁后不能回退生成或接收迟到结果。
test("terrain worker routes out-of-order responses and terminates all pending work on disposal", async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const listeners = new Map<string, () => void>();
  class FakeWorker {
    static instances: FakeWorker[] = [];
    messages: { id?: number; paused?: boolean }[] = [];
    terminated = 0;
    onmessage?: (event: { data: unknown }) => void;
    constructor() { FakeWorker.instances.push(this); }
    postMessage(message: { id?: number; paused?: boolean }) { this.messages.push(message); }
    terminate() { this.terminated++; }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  const document = { hidden: false,
    addEventListener: (name: string, action: () => void) => listeners.set(name, action),
    removeEventListener: (name: string) => listeners.delete(name) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const init = new Initialization(() => 0);
  try {
    const first = computeTerrain({ type: "mountain", layer: 0, mobile: true }, init.fork());
    const second = computeTerrain({ type: "mountain", layer: 1, mobile: true }, init.fork());
    assert.equal(FakeWorker.instances.length, 1);
    const worker = FakeWorker.instances[0], ids = worker.messages.filter(message => message.id).map(message => message.id);
    const a = { position: new Float32Array([1]) }, b = { position: new Float32Array([2]) };
    worker.onmessage!({ data: { id: ids[1], result: b } });
    worker.onmessage!({ data: { id: ids[0], result: a } });
    assert.equal(await first, a); assert.equal(await second, b);
    // 独立预算取消只拒绝自己的请求，同一个 Worker 上的其他消费者仍必须正常完成。
    const child = init.fork();
    const cancelled = computeTerrain({ type: "mountain", layer: 0, mobile: false }, child);
    const sibling = computeTerrain({ type: "mountain", layer: 1, mobile: false }, init.fork());
    const cancelledId = worker.messages.at(-2)!.id, siblingId = worker.messages.at(-1)!.id;
    child.dispose();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.equal(worker.terminated, 0);
    worker.onmessage!({ data: { id: cancelledId, result: a } });
    worker.onmessage!({ data: { id: siblingId, result: b } });
    assert.equal(await sibling, b);
    document.hidden = true; listeners.get("visibilitychange")!();
    assert.deepEqual(worker.messages.at(-1), { paused: true });
    const pending = computeTerrain({ type: "mountain", layer: 2, mobile: true }, init);
    init.dispose(); init.dispose();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(worker.terminated, 1); assert.equal(listeners.size, 0);
    worker.onmessage!({ data: { id: worker.messages.at(-1)?.id, result: a } });
  } finally {
    init.dispose();
    if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
