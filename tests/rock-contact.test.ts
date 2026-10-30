import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Initialization } from "../src/scene/initialization.ts";
import { createRockContacts } from "../src/scene/rock-contact.ts";
import { overlapsChestScenery } from "../src/scene/terrain-clearance.ts";
import { desktopChestPlacement } from "../src/scene/chest-placement.ts";
import { vegetationReach } from "../src/scene/meadow-geometry.ts";

// 补草只能生在实际地面、石面外侧，并保留宝盒完整风摆留白；不能靠挪动石头修补接缝。
test("rock edge grass is grounded outside the stone and preserves its input transforms", async () => {
  const init = new Initialization(() => 0), ground = new THREE.PlaneGeometry(40, 40, 180, 180);
  ground.rotateX(-Math.PI / 2);
  const geometry = new THREE.IcosahedronGeometry(1, 3), matrix = new THREE.Matrix4();
  matrix.compose(new THREE.Vector3(3.68, -.08, 4.08), new THREE.Quaternion(), new THREE.Vector3(.74, .34, .55));
  const matrices = new Float32Array(matrix.elements), before = matrices.slice();
  const contact = await createRockContacts(init, geometry, [
    { matrices, count: 1, ground }, { matrices, count: 0, ground },
  ]);
  assert.deepEqual(matrices, before);
  assert.ok(contact.mesh.count > 12);
  const probe = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.matrixWorld.copy(matrix);
  const ray = new THREE.Raycaster(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < contact.mesh.count; i++) {
    contact.mesh.getMatrixAt(i, matrix); matrix.decompose(p, q, s);
    assert.ok(Math.abs(p.y + .004) < 1e-6, "根部必须贴住实际地面");
    ray.set(new THREE.Vector3(p.x, 3, p.z), new THREE.Vector3(0, -1, 0));
    assert.ok(!ray.intersectObject(probe, false).some(hit => hit.point.y > .012), "不能从石面内部长出草");
    const lean = new THREE.Euler().setFromQuaternion(q).z;
    assert.equal(overlapsChestScenery(p.x, p.z, vegetationReach(s.y, lean, .75), desktopChestPlacement), false);
  }
  // 手机没有这块前景石头时，补草和阴影权重必须一并消失；切回桌面后恢复原缓存。
  const count = contact.mesh.count, snapshot = contact.mesh.instanceMatrix.array.slice();
  assert.ok((contact.shadowMask.value.image.data as Uint8Array).some(value => value > 0));
  contact.setQuality(true);
  assert.equal(contact.mesh.count, 0);
  assert.ok((contact.shadowMask.value.image.data as Uint8Array).every(value => value === 0));
  contact.setQuality(false);
  assert.equal(contact.mesh.count, count);
  assert.deepEqual(contact.mesh.instanceMatrix.array, snapshot);
  init.dispose(); contact.mesh.dispose(); geometry.dispose(); ground.dispose(); probe.material.dispose();
});
