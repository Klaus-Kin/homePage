import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { obstacleFootprint, overlapsFootprint, grassReach, chestFootprint, isForegroundRock } from "../src/scene/terrain-clearance.ts";
import { chestPlacement } from "../src/scene/chest-placement.ts";

// 非等比缩放和三个方向的转动必须全部进入避让计算，不能用根部圆圈近似岩石。
test("rotated scaled rock footprint contains every transformed vertex", () => {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(2, 0, -1),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.2, 0.3)), new THREE.Vector3(2, 0.5, 0.8));
  const vertices = Array.from(geometry.attributes.position.array);
  const footprint = obstacleFootprint(vertices, matrix.elements);
  for (let i = 0; i < vertices.length; i += 3) {
    const point = new THREE.Vector3(...vertices.slice(i, i + 3) as [number, number, number]).applyMatrix4(matrix);
    assert.ok(overlapsFootprint(point.x, point.z, 0.001, footprint));
  }
  assert.equal(overlapsFootprint(20, 20, 0.3, footprint), false);
  geometry.dispose();
});

// 允许石边保留短草，但草尖倾斜、弯曲与风摆的最大包络不能穿入石体。
test("grass clearance covers blade height, lean, curvature and both wind extremes", () => {
  const reach = grassReach(1, 0.15);
  for (const yaw of [0, 0.7, 2, 4]) for (let wind = -1; wind <= 1; wind += 0.1) {
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, 0.15));
    for (const [x, y, z] of [[-0.035,0,0],[0.035,0,0],[-0.018,0.28,0.025],[0.018,0.28,0.025],[0.03,0.54,0.08]]) {
      const point = new THREE.Vector3(x + wind * y * y * 0.24, y, z).applyMatrix4(matrix);
      assert.ok(Math.hypot(point.x, point.z) <= reach);
    }
  }
  const rock = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }];
  assert.equal(overlapsFootprint(1.1, 0.5, reach, rock), true);
  assert.equal(overlapsFootprint(1.1, 0.5, grassReach(0.2, 0), rock), false);
});

test("chest clearance includes the fully unfolded lid and its raised sweep", () => {
  assert.ok(overlapsFootprint(chestPlacement.x - 3.7, chestPlacement.z, 0.1, chestFootprint));
  assert.ok(overlapsFootprint(chestPlacement.x + 1.2, chestPlacement.z, 0.1, chestFootprint));
  assert.equal(overlapsFootprint(0, chestPlacement.z + 1, 0.2, chestFootprint), false);
});

// 岩石中心退到盒后仍可能以宽边伸入前景；完整轮廓越过边界时也必须移出手机实例段。
test("mobile foreground excludes rocks whose edges extend in front of the chest", () => {
  const z = chestPlacement.z;
  assert.equal(isForegroundRock([{x:-2,z:z-2},{x:2,z:z-1}]), false);
  assert.equal(isForegroundRock([{x:-2,z:z-1},{x:2,z:z+.1}]), true);
  assert.equal(isForegroundRock([{x:20,z:z+1}]), true);
});
