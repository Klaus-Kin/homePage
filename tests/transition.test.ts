import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JourneyState,
  isActivation,
  transitionFrame,
  lightSpread,
  WhiteoutGate,
} from "../src/transition.ts";
import { pageConfig } from "../src/config.ts";

// 关键验收条件先写测试：画面必须完全泛白并停留后才允许跳转。
test("normal transition charges for 800ms, fades for 2000ms and holds white for 400ms", () => {
  const frame = (ms: number) =>
    transitionFrame(ms, false, pageConfig.transition);
  assert.equal(frame(799).opacity, 0);
  assert.equal(frame(1800).opacity, 0.5);
  assert.equal(frame(2799).white, false);
  assert.equal(frame(2800).opacity, 1);
  assert.equal(frame(3199).redirect, false);
  assert.equal(frame(3200).redirect, true);
});

test("reduced motion fades in 600ms and still holds pure white before navigation", () => {
  assert.equal(transitionFrame(300, true, pageConfig.transition).opacity, 0.5);
  assert.equal(transitionFrame(600, true, pageConfig.transition).white, true);
  assert.equal(
    transitionFrame(999, true, pageConfig.transition).redirect,
    false,
  );
  assert.equal(
    transitionFrame(1000, true, pageConfig.transition).redirect,
    true,
  );
});

test("loading, repeated activation and redirect cannot restart the journey", () => {
  const state = new JourneyState();
  assert.equal(state.begin(), false);
  state.ready();
  assert.equal(state.begin(), true);
  assert.equal(state.begin(), false);
  state.redirect();
  assert.equal(state.begin(), false);
  assert.equal(state.phase, "redirect");
});

test("taps activate while swipes, long presses and different pointers do not", () => {
  const start = { x: 50, y: 50, time: 0, id: 1 };
  assert.equal(isActivation(start, { x: 55, y: 53, time: 120, id: 1 }), true);
  assert.equal(isActivation(start, { x: 70, y: 50, time: 120, id: 1 }), false);
  assert.equal(isActivation(start, { ...start, time: 800 }), false);
  assert.equal(isActivation(start, { ...start, id: 2 }), false);
});

// 开盖先于光扩散；减少动态仅保留亮白，不能突然把盒盖弹到终点。
test("lid opens in the first 800ms, then the cavity expands until 2800ms", () => {
  const frame = (ms: number) => transitionFrame(ms, false, pageConfig.transition);
  assert.equal(frame(0).lid, 0);
  assert.equal(frame(400).lid, 0.5);
  assert.equal(frame(800).lid, 1);
  assert.equal(frame(800).spread, 0);
  assert.equal(frame(1800).spread, 0.5);
  assert.equal(frame(2800).spread, 1);
  assert.equal(transitionFrame(600, true, pageConfig.transition).lid, 0);
  assert.equal(frame(-20).glow, 0);
});

// 光圈必须以真实光源为中心，最终实心白色覆盖距该点最远的视口角。
test("source-centered spread covers every corner in portrait and landscape", () => {
  for (const [width, height] of [[1920, 1080], [390, 844], [768, 1024], [844, 390]]) {
    for (const source of [{ x: width * 0.74, y: height * 0.76 }, { x: -30, y: height + 5 }]) {
      const middle = lightSpread(width, height, source, 0.5);
      const final = lightSpread(width, height, source, 1);
      assert.equal(middle.x, source.x);
      assert.equal(middle.y, source.y);
      assert.ok(middle.radius < final.radius);
      for (const x of [0, width]) for (const y of [0, height])
        assert.ok(final.radius >= Math.hypot(x - source.x, y - source.y));
      assert.equal(final.feather, 0);
      assert.equal(lightSpread(width, height, source, 0).feather, 0);
      assert.ok(lightSpread(width, height, source, 0.001).feather < middle.feather * 0.03);
    }
  }
});

// 偏好切换可能改变理论终点，导航仍须等实际连续呈现纯白四百毫秒。
test("navigation requires a fresh uninterrupted white hold after preference changes", () => {
  const gate = new WhiteoutGate();
  assert.equal(gate.present(600, true, 400), false);
  assert.equal(gate.present(850, true, 400), false);
  assert.equal(gate.present(900, false, 400), false);
  assert.equal(gate.present(2800, true, 400), false);
  assert.equal(gate.present(3199, true, 400), false);
  assert.equal(gate.present(3200, true, 400), true);
});
