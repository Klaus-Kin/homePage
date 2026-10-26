import { test } from "node:test";
import assert from "node:assert/strict";
import { meteorFrame } from "../src/scene/meteor.ts";
import { groundHeight, mountainHeight } from "../src/scene/terrain-math.ts";

// 连续三个时刻检查头尾与速度的点积，防止旋转和位移分别计算后出现倒飞。
test("meteor head leads its tapering tail down and left", () => {
  const velocity = { x: -8, y: -5, z: 0 };
  let previous = meteorFrame(0, velocity);
  for (const time of [0.2, 0.4, 0.6]) {
    const frame = meteorFrame(time, velocity);
    assert.ok(frame.head.x < previous.head.x && frame.head.y < previous.head.y);
    assert.ok(
      (frame.head.x - frame.tail.x) * velocity.x +
        (frame.head.y - frame.tail.y) * velocity.y >
        0,
    );
    assert.ok(frame.headWidth > frame.tailWidth);
    assert.ok(frame.headAlpha > frame.tailAlpha);
    previous = frame;
  }
});

// 木盒底面所在区域是连续坡面的平缓区域，不另加悬浮底座。
test("the wooden chest base touches a level region of the continuous slope", () => {
  for (const x of [-1.93, 1.93])
    for (const z of [-0.61, 0.61]) assert.equal(groundHeight(x, z), 0);
  assert.ok(Number.isFinite(groundHeight(-25, 14)));
  assert.ok(Math.abs(groundHeight(3, 2) - groundHeight(3.001, 2)) < 0.01);
});

// 山脊必须在纵深方向弯曲，避免把同一条波浪线反复挤出形成平行围墙。
test("mountain ranges have distinct ridges and continuous branched slopes", () => {
  const slopes = [-35, -20, 0, 15, 37].map(
    (x) => mountainHeight(x, 4, 0) - mountainHeight(x, -4, 0),
  );
  assert.ok(Math.max(...slopes) - Math.min(...slopes) > 2);
  assert.notEqual(mountainHeight(3, 2, 0), mountainHeight(3, 2, 2));
  assert.ok(
    Math.abs(mountainHeight(3.001, 2, 0) - mountainHeight(3, 2, 0)) < 0.1,
  );
});
