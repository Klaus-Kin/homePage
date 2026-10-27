import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPlane, computeNormals } from "../src/scene/geometry.ts";
import { Initialization } from "../src/scene/initialization.ts";

// 与原生算法逐元素比较，保证分批不会偷偷降低几何精度或改变 UV、光照。
test("batched plane and deformed normals match the original Three.js geometry", async () => {
  const init = new Initialization();
  const actual = await createPlane(130, 52, 80, 36, init), expected = new THREE.PlaneGeometry(130, 52, 80, 36);
  assert.deepEqual(actual.index!.array, expected.index!.array);
  for (const key of ["position", "normal", "uv"])
    assert.deepEqual(actual.attributes[key].array, expected.attributes[key].array);
  for (const geometry of [actual, expected]) {
    geometry.rotateX(-Math.PI / 2);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i)) * Math.cos(p.getZ(i)));
  }
  await computeNormals(actual, init); expected.computeVertexNormals();
  assert.deepEqual(actual.attributes.normal.array, expected.attributes.normal.array);
  init.dispose(); expected.dispose();
});
