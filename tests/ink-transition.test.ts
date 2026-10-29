import { test } from "node:test";
import assert from "node:assert/strict";
import { InkTimeline, BlackPresentationGate } from "../src/ink-timeline.ts";
import { inkGeometry, inkRadius, canvasSize } from "../src/ink-geometry.ts";
import { VisibleTime } from "../src/inscription-timeline.ts";

// 起点只能来自完整题词实际出现的帧，晚帧不能预支落墨或全黑停留。
test("ink starts immediately on actual completion and fills at 2400ms", () => {
  const timeline = new InkTimeline();
  assert.equal(timeline.present(8000, false, false).stage, "waiting");
  assert.equal(timeline.present(12000, true, false).stage, "drop");
  assert.equal(timeline.present(12119, true, false).stage, "drop");
  assert.equal(timeline.present(12120, true, false).stage, "splash");
  assert.equal(timeline.present(12360, true, false).stage, "spread");
  assert.equal(timeline.present(14399, true, false).black, false);
  assert.equal(timeline.present(14400, true, false).black, true);
});

test("reduced motion and canvas failure each fade for a fresh 180ms", () => {
  for (const failed of [false, true]) {
    const timeline = new InkTimeline();
    const first = timeline.present(9000, true, !failed, failed);
    assert.equal(first.stage, "fade"); assert.equal(first.fade, 0);
    assert.equal(timeline.present(9090, true, false, failed).fade, .5);
    assert.equal(timeline.present(9179, true, false, failed).black, false);
    assert.equal(timeline.present(9180, true, false, failed).black, true);
  }
});

test("mid-ink preference or drawing failure freezes the last drawn ink and never replays", () => {
  for (const failed of [false, true]) {
    const timeline = new InkTimeline();
    timeline.present(0, true, false);
    const drawn = timeline.present(800, true, false);
    const frozen = timeline.present(1000, true, !failed, failed);
    assert.equal(frozen.elapsed, drawn.elapsed); assert.equal(frozen.fade, 0);
    assert.equal(timeline.present(1090, true, false, failed).elapsed, drawn.elapsed);
    assert.equal(timeline.present(1180, true, false, failed).black, true);
  }
});

test("navigation waits for 160ms of rendered pure black even after a very late frame", () => {
  const gate = new BlackPresentationGate();
  assert.equal(gate.present(2400, false), false);
  assert.equal(gate.present(10000, true), false);
  assert.equal(gate.present(10159, true), false);
  assert.equal(gate.present(10160, true), true);
});

// 主 RAF 先确认上一帧的渲染结果，再提交本帧；首次改成黑底不能算作已经看见黑场。
test("the first black CSS commit is acknowledged on the next frame before its hold starts", () => {
  const gate = new BlackPresentationGate();
  let committed = false;
  const frame = (time: number) => { const navigate = gate.present(time, committed); committed = true; return navigate; };
  assert.equal(frame(10000), false);
  assert.equal(frame(10016), false);
  assert.equal(frame(10160), false);
  assert.equal(frame(10175), false);
  assert.equal(frame(10176), true);
});

test("background pauses drop, spread and the pure black hold", () => {
  for (const offset of [60, 200, 1000, 2450]) {
    const clock = new VisibleTime(), timeline = new InkTimeline(), gate = new BlackPresentationGate();
    const frame = (now: number) => { const time = clock.sample(now); const ink = timeline.present(time, true, false); return { ink, redirect: gate.present(time, ink.black) }; };
    frame(0); const before = frame(offset);
    clock.pause(); assert.deepEqual(frame(90000), before);
    if (offset === 2450) { assert.equal(frame(90159).redirect, false); assert.equal(frame(90160).redirect, true); }
  }
});

// 几何参数可重复，边界只向外生长；预算按真实画布像素取整后仍满足上限。
test("deterministic splashes and 256 monotone boundary samples cover every viewport", () => {
  assert.deepEqual(inkGeometry(), inkGeometry());
  const geometry = inkGeometry();
  assert.equal(geometry.edge.length, 256); assert.equal(geometry.drops.length, 14); assert.equal(geometry.filaments.length, 6);
  for (const [width, height] of [[320,480],[640,600],[1100,1000],[390,844],[3440,1440],[7680,4320]]) {
    const budget = canvasSize(width, height, 3);
    assert.ok(budget.width * budget.height <= 2500000); assert.ok(budget.ratio <= 1.5);
    // 双缓冲也共用总预算，不能为保留上一帧而将绘图像素翻倍。
    const buffered = canvasSize(width, height, 3, 2);
    assert.ok(buffered.width * buffered.height * 2 <= 2500000);
    const coverage = Math.hypot(width, height) / Math.min(...geometry.edge);
    let previous = 0;
    for (let t = 120; t <= 2400; t += 16) {
      const radius = inkRadius(t, coverage, 36);
      assert.ok(radius >= previous); previous = radius;
    }
    assert.ok(inkRadius(2400, coverage, 36) * Math.min(...geometry.edge) >= Math.hypot(width, height));
  }
});
