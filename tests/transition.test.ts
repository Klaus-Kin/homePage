import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JourneyState,
  isActivation,
  transitionFrame,
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
