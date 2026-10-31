import { test } from "node:test";
import assert from "node:assert/strict";
import { InscriptionTimeline, VisibleTime } from "../src/inscription-timeline.ts";
import { pageConfig } from "../src/config.ts";

// 完整题词只输出完成信号，后续落墨消费实际呈现帧，不再包含阅读等待。
test("inscription completes writing and announces once without navigation", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  assert.equal(timeline.present(2800, true, false).visible, false);
  assert.equal(timeline.present(2919, true, false).visible, false);
  assert.equal(timeline.present(2920, true, false).announce, true);
  assert.equal(timeline.present(4420, true, false).progress, .5);
  assert.equal(timeline.present(5919, true, false).complete, false);
  const full = timeline.present(5920, true, false);
  assert.equal(full.complete, true); assert.equal("redirect" in full, false);
  assert.equal(timeline.present(9000, true, true).announce, false);
  assert.equal(timeline.present(9000, true, false).progress, 1);
});

// 后台不消耗书写时间，恢复首帧仅重新建立可见时间锚点。
test("visible time pauses writing without counting the resume frame", () => {
  const clock = new VisibleTime(), timeline = new InscriptionTimeline(pageConfig.transition);
  const frame = (now: number, hidden = false) => timeline.present(clock.sample(now, hidden), true, false);
  frame(100); frame(220);
  assert.equal(frame(1720).progress, .5);
  clock.pause(); frame(10000, true);
  assert.equal(frame(20000).progress, .5);
  assert.equal(frame(21500).complete, true);
});

test("reduced motion fades the full sentence for 180ms without a reading hold", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(600, true, true);
  assert.equal(timeline.present(720, true, true).mode, "fade");
  assert.equal(timeline.present(810, true, true).opacity, .5);
  assert.equal(timeline.present(900, true, true).complete, true);
});

test("enabling reduced motion freezes strokes and never replays on switching back", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(0, true, false); timeline.present(120, true, false);
  assert.equal(timeline.present(1120, true, false).progress, 1 / 3);
  const switched = timeline.present(1220, true, true);
  assert.equal(switched.mode, "fade"); assert.equal(switched.progress, 1 / 3);
  assert.equal(switched.opacity, 0); assert.equal(switched.announce, false);
  assert.equal(timeline.present(1310, true, false).opacity, .5);
  assert.equal(timeline.present(1400, true, false).complete, true);
});

test("late completion is signaled on the actual frame without backdating", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(0, true, false); timeline.present(120, true, false);
  assert.equal(timeline.present(10000, true, false).complete, true);
});

// 冷启动的长任务不能一次耗尽开盖、书写或落墨；普通可见时钟仍保留原来的实时时间语义。
test("presentation clock limits long foreground stalls and keeps background pause", () => {
  const clock = new VisibleTime(50);
  assert.equal(clock.sample(0), 0);
  assert.equal(clock.sample(16), 16);
  assert.equal(clock.sample(10016), 66);
  assert.equal(clock.sample(10032), 82);
  clock.pause();
  assert.equal(clock.sample(90000), 82);
  assert.equal(clock.sample(90016), 98);
  const realtime = new VisibleTime();
  realtime.sample(0);
  assert.equal(realtime.sample(10000), 10000);
});
