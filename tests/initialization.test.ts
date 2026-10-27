import { test } from "node:test";
import assert from "node:assert/strict";
import { Initialization } from "../src/scene/initialization.ts";

// 用可控时钟确认让出的是任务调度器，预算内不会制造大量微任务。
test("initialization yields after its 8ms budget and resets the batch clock", async () => {
  let time = 0, scheduled = 0;
  const init = new Initialization(() => time, async () => { scheduled++; time += 100; });
  time = 7; assert.equal(init.checkpoint(), undefined);
  time = 8; await init.checkpoint();
  assert.equal(scheduled, 1);
  assert.equal(init.checkpoint(), undefined);
  time += 9; await init.checkpoint();
  assert.deepEqual(init.batches, [8, 9]);
});

// 在任务已经排队后取消，续体不得恢复生成；共享和半成品资源均只能释放一次。
test("cancellation rejects queued work and disposes shared resources once", async () => {
  let resume!: () => void, disposed = 0;
  const init = new Initialization(() => 10, () => new Promise((resolve) => { resume = resolve; }));
  const item = { dispose() { disposed++; } };
  init.track(item); init.track(item);
  const pending = init.checkpoint(true)!;
  init.dispose(); init.dispose(); resume();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(disposed, 1);
  assert.throws(() => init.checkpoint(), { name: "AbortError" });
});

// 网络迟到时立即退出等待，待下载返回再释放纹理，不能重新交付场景。
test("late textures are released after cancellation without reviving initialization", async () => {
  let resolve!: (value: { dispose(): void }) => void, disposed = 0;
  const init = new Initialization();
  const waiting = init.wait(new Promise((done) => { resolve = done; }));
  init.dispose();
  await assert.rejects(waiting, { name: "AbortError" });
  resolve({ dispose() { disposed++; } });
  await Promise.resolve();
  assert.equal(disposed, 1);
});
