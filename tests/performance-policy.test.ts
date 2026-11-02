import { test } from "node:test";
import assert from "node:assert/strict";
import { AdaptiveQuality, coalesceFrame } from "../src/performance-policy.ts";

// 可控时间验证滞回和冷却；不能用单次重帧或刚恢复的窗口触发反复升降。
test("quality requires sustained slow frames, respects cooldown and recovers conservatively", () => {
  const policy = new AdaptiveQuality();
  let now = 0;
  const run = (duration: number, gap: number) => {
    let cursor = false;
    for (const end = now + duration; now < end; now += gap) cursor = policy.sample(now, gap).slowCursor || cursor;
    return cursor;
  };
  assert.equal(run(2200, 40), true); assert.equal(policy.level, 0);
  run(2200, 40); assert.equal(policy.level, 1);
  run(2200, 40); assert.equal(policy.level, 1);
  run(4400, 40); assert.equal(policy.level, 2);
  policy.reset(); run(14000, 16); assert.equal(policy.level, 2);
  run(6000, 16); assert.equal(policy.level, 1);
});

// 重复事件只执行一次，取消后旧回调和新事件均不能再改变页面。
test("resize coalesces both event sources and rejects callbacks after disposal", () => {
  let callback!: FrameRequestCallback, calls = 0, scheduled = 0, cancelled = 0;
  const resize = coalesceFrame(() => calls++, cb => { callback = cb; return ++scheduled; }, () => cancelled++);
  resize.request(); resize.request(); assert.equal(scheduled, 1);
  callback(0); assert.equal(calls, 1);
  resize.request(); resize.dispose(); callback(0); resize.request();
  assert.equal(calls, 1); assert.equal(scheduled, 2); assert.equal(cancelled, 1);
});
