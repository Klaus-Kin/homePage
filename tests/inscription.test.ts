import { test } from "node:test";
import assert from "node:assert/strict";
import { InscriptionTimeline, VisibleTime } from "../src/inscription-timeline.ts";
import { pageConfig } from "../src/config.ts";

// 以实际呈现的帧作为起点，光幕铺满后的等待、书写和阅读均不能被理论终点提前消耗。
test("inscription waits 120ms, writes for 3000ms, then holds the complete sentence for 1200ms", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  assert.equal(timeline.present(2800, true, false).visible, false);
  assert.equal(timeline.present(2919, true, false).visible, false);
  const start = timeline.present(2920, true, false);
  assert.equal(start.announce, true);
  assert.equal(start.progress, 0);
  assert.equal(timeline.present(4420, true, false).progress, 0.5);
  assert.equal(timeline.present(5919, true, false).complete, false);
  assert.equal(timeline.present(5920, true, false).complete, true);
  assert.equal(timeline.present(7119, true, false).redirect, false);
  assert.equal(timeline.present(7120, true, false).redirect, true);
  assert.equal(timeline.present(9000, true, false).progress, 1);
  assert.equal(timeline.present(9000, true, false).announce, false);
});

// 虚拟时钟覆盖书写和阅读两个阶段的后台暂停，恢复后的首帧不计入隐藏时长。
test("visible time pauses writing and reading while the page is hidden", () => {
  const clock = new VisibleTime();
  const timeline = new InscriptionTimeline(pageConfig.transition);
  const frame = (now: number, hidden = false) => timeline.present(clock.sample(now, hidden), true, false);
  frame(100); frame(220);
  assert.equal(frame(1720).progress, 0.5);
  clock.pause();
  assert.equal(frame(10000, true).progress, 0.5);
  assert.equal(frame(20000).progress, 0.5);
  assert.equal(frame(21500).complete, true);
  frame(22000);
  clock.pause(); frame(30000, true);
  assert.equal(frame(40000).redirect, false);
  assert.equal(frame(40699).redirect, false);
  assert.equal(frame(40700).redirect, true);
});

// 减少动态使用整句淡入；完整句子的阅读计时从淡入完成的实际帧重新开始。
test("reduced motion fades the full sentence for 180ms and holds it for 1200ms", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(600, true, true);
  assert.equal(timeline.present(720, true, true).mode, "fade");
  assert.equal(timeline.present(810, true, true).opacity, 0.5);
  assert.equal(timeline.present(900, true, true).complete, true);
  assert.equal(timeline.present(2099, true, true).redirect, false);
  assert.equal(timeline.present(2100, true, true).redirect, true);
});

test("enabling reduced motion mid-stroke fades remaining ink and never replays after switching back", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(0, true, false); timeline.present(120, true, false);
  assert.equal(timeline.present(1120, true, false).progress, 1 / 3);
  const switchFrame = timeline.present(1220, true, true);
  assert.equal(switchFrame.mode, "fade");
  assert.equal(switchFrame.progress, 1 / 3);
  assert.equal(switchFrame.opacity, 0);
  assert.equal(switchFrame.announce, false);
  assert.equal(timeline.present(1310, true, false).opacity, 0.5);
  assert.equal(timeline.present(1400, true, false).complete, true);
  assert.equal(timeline.present(2599, true, true).redirect, false);
  assert.equal(timeline.present(2600, true, false).redirect, true);
});

test("preference changes after completion do not restart the sentence or its reading hold", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(2800, true, false); timeline.present(2920, true, false);
  timeline.present(5920, true, false);
  assert.equal(timeline.present(6500, true, true).complete, true);
  assert.equal(timeline.present(7120, true, false).redirect, true);
});

// 连续完全遮盖被打断时，隐藏题词并撤销旧阅读时间；已画出的墨迹保留，不重播。
test("loss of full coverage revokes navigation and requires a fresh uninterrupted reading hold", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(600, true, true); timeline.present(720, true, true);
  timeline.present(900, true, true); timeline.present(1400, true, true);
  assert.equal(timeline.present(1500, false, false).visible, false);
  assert.equal(timeline.present(2800, true, false).redirect, false);
  assert.equal(timeline.present(2920, true, false).complete, true);
  assert.equal(timeline.present(4119, true, false).redirect, false);
  assert.equal(timeline.present(4120, true, false).redirect, true);
});

test("late presentation cannot spend the complete sentence reading hold before it was rendered", () => {
  const timeline = new InscriptionTimeline(pageConfig.transition);
  timeline.present(0, true, false); timeline.present(120, true, false);
  assert.equal(timeline.present(10000, true, false).redirect, false);
  assert.equal(timeline.present(11199, true, false).redirect, false);
  assert.equal(timeline.present(11200, true, false).redirect, true);
});
