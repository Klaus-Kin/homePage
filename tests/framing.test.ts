import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { keepBoundsInView, projectBounds } from "../src/responsive.ts";
import { sceneConfig, selectSceneLayout } from "../src/config.ts";
import { chestPlacement } from "../src/scene/chest-placement.ts";
import { chestPose, chestMotionBounds } from "../src/scene/chest-motion.ts";

// 完整运动范围在首帧适配一次；后续逐角度检查，禁止以动态平移镜头来掩盖展开出画。
test("closer chest stays visible throughout opening with a stationary camera", () => {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(chestPlacement.x, 0, chestPlacement.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
    new THREE.Vector3().setScalar(chestPlacement.scale));
  for (const [width, height] of [[1920,1080], [1366,1024], [1024,1366], [768,1024],
    [360,800], [390,844], [430,932], [844,390]]) {
    const preset = sceneConfig.layout[selectSceneLayout(width, height)];
    const camera = new THREE.PerspectiveCamera(preset.fov, width / height, 0.1, 350);
    const base = new THREE.Vector3(preset.cameraX, preset.height, preset.distance);
    camera.position.copy(base); camera.lookAt(preset.cameraX, preset.targetY, 0);
    const m = chestMotionBounds();
    const motion = new THREE.Box3(new THREE.Vector3(m.minX, m.minY, m.minZ),
      new THREE.Vector3(m.maxX, m.maxY, m.maxZ)).expandByScalar(0.03);
    keepBoundsInView(motion, matrix, camera, width, height);
    const fixed = camera.position.clone();
    const hinge = new THREE.Vector3(1.93, 0.61, 0).applyMatrix4(matrix).project(camera);
    for (let step = 0; step <= 180; step++) {
      const b = chestPose(step / 180).bounds;
      const bounds = new THREE.Box3(new THREE.Vector3(b.minX, b.minY, b.minZ),
        new THREE.Vector3(b.maxX, b.maxY, b.maxZ)).expandByScalar(0.03);
      const projected = projectBounds(bounds, matrix, camera, width, height);
      assert.ok(projected.left >= 11.8 && projected.right <= width - 11.8,
        `${width}x${height}/${step}: ${JSON.stringify(projected)}`);
      assert.ok(projected.top >= 0 && projected.bottom <= height);
      assert.ok(camera.position.equals(fixed), "开盖期间镜头必须固定");
      assert.ok(new THREE.Vector3(1.93, 0.61, 0).applyMatrix4(matrix).project(camera).equals(hinge),
        "固定铰链的投影不能随盖子移动");
      assert.ok(camera.position.distanceTo(base) < 3, "首帧只允许必要的小幅适配");
    }
  }
});
