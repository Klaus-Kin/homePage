import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { sceneConfig, selectSceneLayout } from "../src/config.ts";
import { screenPoint } from "../src/responsive.ts";
import { chestPlacement } from "../src/scene/chest-placement.ts";
import { syncMoonLight } from "../src/scene/moonlight.ts";

// 使用真实构图反投影月球，检查灯光与月球共线、投影背离月球，且横竖屏会改变世界光向。
test("moonlight and ground shadows follow the actual responsive moon position", () => {
  const light = new THREE.DirectionalLight(), moon = new THREE.Object3D();
  const target = new THREE.Vector3(chestPlacement.x, 0.3, chestPlacement.z);
  const directions: THREE.Vector3[] = [];
  for (const [width, height] of [[1920,1080], [1366,768], [768,1024], [390,844], [844,390]]) {
    const preset = sceneConfig.layout[selectSceneLayout(width, height)];
    const camera = new THREE.PerspectiveCamera(preset.fov, width / height, 0.1, 350);
    camera.position.set(preset.cameraX, preset.height, preset.distance);
    camera.lookAt(preset.cameraX, preset.targetY, 0);
    camera.updateMatrixWorld();
    moon.position.copy(screenPoint(camera, preset.moon[0], preset.moon[1], 80));
    assert.equal(syncMoonLight(light, moon, target), true);
    const actual = light.position.clone().sub(light.target.position).normalize();
    const expected = moon.position.clone().sub(target).normalize();
    assert.ok(actual.distanceTo(expected) < 1e-12, `${width}x${height}: 主光必须来自月球`);
    assert.ok(light.target.position.equals(target));
    const heightAboveGround = 0.6;
    const shadow = new THREE.Vector3(-actual.x, 0, -actual.z).multiplyScalar(heightAboveGround / actual.y);
    assert.ok(shadow.x * expected.x + shadow.z * expected.z < 0, "地面阴影应投向背月侧");
    assert.equal(syncMoonLight(light, moon, target), false, "静止光源无需反复更新阴影贴图");
    directions.push(actual);
  }
  assert.ok(directions[0].distanceTo(directions[3]) > 0.1, "桌面与手机应有不同光向");
  // 同一分辨率下月球发生位移，光源也必须立即跟随，不能只在启动时绑定一次。
  moon.position.x += 5;
  assert.equal(syncMoonLight(light, moon, target), true);
  assert.ok(light.position.clone().sub(target).normalize().distanceTo(directions.at(-1)!) > 0.01);
});
