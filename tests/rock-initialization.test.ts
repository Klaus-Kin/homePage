import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Initialization } from "../src/scene/initialization.ts";
import { createWeatheredRockGeometry } from "../src/scene/rock-surface.ts";

// 焊接后的几何已经拥有实际缓冲；法线分批开始前取消时也必须完整释放这个半成品。
test("rock normals can be cancelled after welding without leaking intermediate geometry", async () => {
  const envelope = new THREE.IcosahedronGeometry(1, 2);
  const init = new Initialization(() => 0, async () => {
    if (init.phase === "weathered-rock-normals") init.dispose();
  });
  await assert.rejects(createWeatheredRockGeometry(envelope, init), { name: "AbortError" });
  assert.equal(init.controller.signal.aborted, true);
  envelope.dispose();
});

// 分批法线必须与 Three.js 同样按索引顺序累加；完整几何仍保持原来的实际光照结果。
test("completed rock normals are identical to Three.js and owned by initialization", async () => {
  const envelope = new THREE.IcosahedronGeometry(1, 2), init = new Initialization(() => 0, async () => {});
  const geometry = await createWeatheredRockGeometry(envelope, init);
  const reference = geometry.clone(); reference.computeVertexNormals();
  assert.deepEqual(geometry.attributes.normal.array, reference.attributes.normal.array);
  let releases = 0;
  geometry.addEventListener("dispose", () => releases++);
  init.dispose(); init.dispose();
  assert.equal(releases, 1);
  reference.dispose(); envelope.dispose();
});
