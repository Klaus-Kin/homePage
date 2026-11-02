import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { computeMountain, computeMeadow } from "../src/scene/terrain-compute.ts";
import { computeTerrain } from "../src/scene/terrain-worker-client.ts";
import { Initialization } from "../src/scene/initialization.ts";

const hash = (array: Float32Array | Uint16Array | Uint32Array) =>
  createHash("sha256").update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest("hex");

// 摘要取自省略零权重噪声之前；全部五层、两档画质和 UV 一并核对，不能只验证近景主峰。
test("zero-weight mountain work preserves all five layers and both quality levels", async () => {
  const expected = ["aae73c0a7d94d546d0a9f2d25a4f4bdc13e4c6e2f8c2a2fae3a08ceab84a561d",
    "ce33d6ace8aa3a4cf3c5f1bcc73d022b8b01b6d48558d8cea1c62ef486e58d53"];
  for (const mobile of [false, true]) {
    const combined = createHash("sha256");
    for (let layer = 0; layer < 5; layer++) {
      const init = new Initialization(() => 0);
      const data = await computeMountain(layer, mobile, init);
      for (const name of ["position", "normal", "uv", "color", "index"] as const) {
        const array = data[name];
        combined.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
      init.dispose();
    }
    assert.equal(combined.digest("hex"), expected[Number(mobile)]);
  }
});

// 摘要来自本次优化前 Git HEAD 的原算法，覆盖顶点、法线、颜色和索引，防止跨线程迁移改变山脊与受光。
test("terrain computation preserves original desktop and mobile mountain buffers exactly", async () => {
  const expected = [
    ["a3aef8a7a88bd6d4bbe347689f9c5d09c3e9c251f22deb160cab9f7161956708", "d7664f0fb61f69d281558cb13882eb775923db35aaada282396b35bdc41ba633", "f190d0577b77a4532a617d131dc96699013652192b0783056f32e6bba2a345f6", "d64c34ec36141d3896eed88e22a532c3e6f46c85e14da237850760d80a2b8f2a"],
    ["3b1f4966410db3a86e605823a880498a15c3ef448e386702e5880584ace81f30", "46578b54a86a136b78ba592f8ac1930b49b5da8c10699742f7f5e6f517e9a046", "39538b8051c815eb421651237c4682bbd9355778964478d4da1629307083d456", "ea15612d7b14016729114a0d62c9eaba268c24bcd1b42a1748c721d04e7e721c"],
  ];
  for (const mobile of [false, true]) {
    const init = new Initialization(() => 0);
    const data = await computeMountain(0, mobile, init);
    assert.deepEqual([data.position, data.normal, data.color, data.index].map(hash), expected[Number(mobile)]);
    init.dispose();
  }
});

// 原算法同时生成两档；新算法只生成指定档位，矩阵、颜色、独立补草序列必须逐字节一致。
test("one-quality meadow generation retains original seeds and supplemental coverage", async () => {
  const expected = [
    [56000, "e18ba85309f68a61ec61abc9c0b7b5414b5466b8327ee9d596c157f94117aec4", "c4d38d7f43542b172bb4a613673a811136ba1a979166211142a6d1a5d1789b43"],
    [22500, "52f18a790d2857865bf3fbef6318b32e7350a47fe6964ac8b3556f33a6e380d6", "daf120abbfa6ef9e1bf8d32f775346761a935c2b02d41f79c79aa862fa44ed59"],
  ];
  const ground = new THREE.PlaneGeometry(130, 130, 180, 180);
  ground.rotateX(-Math.PI / 2); ground.translate(0, 0, -40);
  for (const mobile of [false, true]) {
    const init = new Initialization(() => 0);
    const data = await computeMeadow({ type: "meadow", kind: "turf", mobile, seed: 9127, strength: .35,
      ground: ground.attributes.position.array as Float32Array, footprints: [] }, init);
    assert.deepEqual([data.count, hash(data.matrices), hash(data.colors)], expected[Number(mobile)]);
    init.dispose();
  }
  ground.dispose();
});

// 无 Worker 仍能生成，已取消的资源域必须即时拒绝，不能进入昂贵的回退计算。
test("terrain worker fallback shares the algorithm and respects cancellation", async () => {
  const init = new Initialization(() => 0);
  const data = await computeTerrain({ type: "mountain", layer: 0, mobile: true }, init);
  assert.equal(hash(data.position), "3b1f4966410db3a86e605823a880498a15c3ef448e386702e5880584ace81f30");
  init.dispose();
  await assert.rejects(computeTerrain({ type: "mountain", layer: 0, mobile: true }, init), { name: "AbortError" });
});
