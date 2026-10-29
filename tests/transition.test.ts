import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JourneyState,
  isActivation,
  transitionFrame,
  lightSpread,
} from "../src/transition.ts";
import { pageConfig } from "../src/config.ts";

// 光幕只负责覆盖画面，导航由独立的实际全黑门禁控制。
test("normal transition charges for 800ms and spreads for 2000ms without calculating navigation", () => {
  const frame = (ms: number) =>
    transitionFrame(ms, false, pageConfig.transition);
  assert.equal(frame(799).opacity, 0);
  assert.equal(frame(1800).opacity, 0.5);
  assert.equal(frame(2799).white, false);
  assert.equal(frame(2800).opacity, 1);
  assert.equal("redirect" in frame(10000), false);
});
test("reduced motion fades in 600ms without calculating navigation", () => {
  assert.equal(transitionFrame(300, true, pageConfig.transition).opacity, 0.5);
  assert.equal(transitionFrame(600, true, pageConfig.transition).white, true);
  assert.equal("redirect" in transitionFrame(10000, true, pageConfig.transition), false);
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

// 开盖先于光扩散；减少动态仅保留淡黄光幕，不能突然把盒盖弹到终点。
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

// 光圈必须以真实光源为中心，最终实心光幕覆盖距该点最远的视口角。
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
