import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceYaw, CHOICE_DURATION, choiceKeyframes } from "../src/choice-prompt.ts";

// 宝盒绕竖直轴的偏移必须有界，260ms 后精确归零，减少动态始终保持基准姿态。
test("choice yaw decays within 1.2 degrees without changing the closed pose", () => {
  let peak = 0;
  for (let ms = 0; ms <= CHOICE_DURATION; ms++) {
    const yaw = choiceYaw(ms, false);
    peak = Math.max(peak, Math.abs(yaw));
    assert.ok(Math.abs(yaw) <= 1.2 * Math.PI / 180);
    assert.equal(choiceYaw(ms, true), 0);
    if (ms >= 260) assert.equal(yaw, 0);
  }
  assert.ok(peak > .5 * Math.PI / 180);
  assert.equal(choiceYaw(0, false), 0);
});

// 文字共用一个动画外层：80ms 后开始，两次衰减往返，720ms 精确归位。
test("choice translation has a shared delay, two diminishing cycles and a static reduced variant", () => {
  const frames = choiceKeyframes(false);
  assert.deepEqual(frames.map(frame => frame.transform), [
    "translateX(0px)", "translateX(0px)", "translateX(6px)", "translateX(-6px)",
    "translateX(3px)", "translateX(-3px)", "translateX(0px)",
  ]);
  assert.equal(frames[1].offset, 80 / CHOICE_DURATION);
  assert.equal(frames.at(-1)!.offset, 1);
  assert.ok(choiceKeyframes(true).every(frame => frame.transform === "translateX(0px)"));
});
