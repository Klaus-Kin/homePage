import { test } from "node:test";
import assert from "node:assert/strict";
import { chestPose } from "../src/scene/chest-motion.ts";
import { groundHeight } from "../src/scene/terrain-math.ts";
import { chestPlacement } from "../src/scene/chest-placement.ts";

// 回归最新确认的上翻结构：左短端水平铰链，旋转平面垂直于地面，纵深保持固定。
test("chest halves start closed and lift vertically to 180 degrees around the left end", () => {
  assert.equal(chestPose(0).angle, 0);
  assert.ok(Math.abs(chestPose(1).angle * 180 / Math.PI - 180) < 1e-10);
  assert.deepEqual(chestPose(0).hinge, { x: 1.93, y: 0.61, z: 0 });
  for (let i = 0; i <= 100; i++) {
    const { angle, bounds } = chestPose(i / 100);
    assert.equal(bounds.minY, 0);
    assert.equal(bounds.minZ, -0.22);
    assert.equal(bounds.maxZ, 0.22);
    for (const x of [-1.93, 1.93]) for (const y of [0, 0.61]) {
      const px = 1.93 + (x - 1.93) * Math.cos(angle) + y * Math.sin(angle);
      const py = 0.61 - (x - 1.93) * Math.sin(angle) + y * Math.cos(angle);
      assert.ok(px >= bounds.minX && px <= bounds.maxX);
      assert.ok(py >= bounds.minY && py <= bounds.maxY);
    }
  }
});

// 待机时上下半盒沿水平接缝相合，默认开盖角度为零。
test("idle halves share their closing seam without any opening angle", () => {
  const { bounds } = chestPose(0);
  assert.equal(bounds.maxX - bounds.minX, 3.86);
  assert.equal(bounds.maxY - bounds.minY, 1.22);
  assert.equal(bounds.maxZ - bounds.minZ, 0.44);
  assert.equal(chestPose(-1).angle, 0);
  assert.ok(Math.abs(chestPose(0.5).angle - Math.PI / 2) < 1e-10);
});

// 完全展开后等长半盒首尾相接，而非只把整块上盖转了另一个轴。
test("fully open equal halves form a double-length strip with aligned cavities", () => {
  const { bounds } = chestPose(1);
  assert.ok(Math.abs(bounds.maxX - bounds.minX - 7.72) < 1e-10);
  assert.ok(Math.abs(bounds.maxY - 0.61) < 1e-10);
  assert.ok(chestPose(0.5).bounds.maxY > 4, "中途必须真正抬离地面");
});

// 上盖落到左侧后，两条半盒均由地面支撑；抬升期间不会穿过地面。
test("fixed half and fully unfolded lid are supported by the ground", () => {
  for (const progress of [0, 1]) {
    const { bounds } = chestPose(progress);
    for (const x of [bounds.minX, bounds.maxX]) for (const z of [-0.22, 0.22]) {
      const worldX = chestPlacement.x - chestPlacement.scale * x,
        worldZ = chestPlacement.z - chestPlacement.scale * z;
      assert.equal(groundHeight(worldX, worldZ), 0, `盒底脱离地面: ${worldX},${worldZ}`);
    }
  }
});
