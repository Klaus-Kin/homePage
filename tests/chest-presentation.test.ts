import { test } from "node:test";
import assert from "node:assert/strict";
import { chestPlacement, selectChestPlacement } from "../src/scene/chest-placement.ts";
import { chestLightFrame } from "../src/scene/chest-light.ts";
import { chestPose } from "../src/scene/chest-motion.ts";
import { groundHeight } from "../src/scene/terrain-math.ts";
import { overlapsChestScenery } from "../src/scene/terrain-clearance.ts";

// 手机保持上一版的实体位置和比例；PC 只改变坐标，不能用缩放替代后移。
test("PC moves the chest back and left while phone placement and physical scale stay fixed", () => {
  assert.deepEqual(selectChestPlacement(true), { x: 0.3, z: 6.9, scale: 0.64 });
  const pc = selectChestPlacement(false);
  assert.ok(pc.x < chestPlacement.x && pc.z < chestPlacement.z);
  assert.equal(pc.scale, chestPlacement.scale);
});

// 关盖时所有内部发光通道都归零，减少动态也不能偷偷留下静态黄光。
test("idle chest has no cavity lights, glow planes, mouth halo or inner emission", () => {
  for (const reduced of [false, true]) {
    const frame = chestLightFrame(0, 0, reduced);
    assert.ok(Object.values(frame).every(value => value === 0));
  }
});

// 开盖越多，原有淡金光越亮；减少动态只渐亮光，不要求盒盖运动。
test("cavity glow grows with opening and preserves the existing fully open gold light", () => {
  const closed = chestLightFrame(0, 0, false);
  const first = chestLightFrame(0.1, 0.018, false);
  const middle = chestLightFrame(0.5, 0.09, false);
  const open = chestLightFrame(1, 0.18, false);
  for (const key of Object.keys(closed) as (keyof typeof closed)[]) {
    assert.ok(first[key] > closed[key] && middle[key] > first[key] && open[key] > middle[key]);
  }
  assert.equal(open.intensity, 0.35 + 0.18 * 7);
  assert.equal(open.glowOpacity, 0.22 + 0.18 * 0.78);
  assert.ok(chestLightFrame(0, 0.5, true).intensity > 0);
});

// 两种位置的闭盒、完整展开落点都落在同一连续地面的平缓支撑区，并留下植被净空。
test("both placements keep the base and unfolded lid supported and clear of scenery", () => {
  for (const mobile of [true, false]) {
    const placement = selectChestPlacement(mobile);
    for (const progress of [0, 1]) {
      const bounds = chestPose(progress).bounds;
      for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) {
        const wx = placement.x - x * placement.scale, wz = placement.z - z * placement.scale;
        assert.equal(groundHeight(wx, wz, placement), 0);
        assert.ok(overlapsChestScenery(wx, wz, 0.1, placement));
      }
    }
  }
});
