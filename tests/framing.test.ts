import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { keepBoundsInView, projectBounds, openingCameraPosition } from "../src/responsive.ts";
import { sceneConfig, selectSceneLayout } from "../src/config.ts";
import { chestPlacement } from "../src/scene/chest-placement.ts";
import { chestPose, chestMotionBounds } from "../src/scene/chest-motion.ts";

// 近景和展开端点预先适配；连续采样检查模型完整可见与镜头轨迹，不再等到出界才跳动修正。
test("foreground chest stays visible through continuously planned opening framing", () => {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(chestPlacement.x, 0, chestPlacement.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
    new THREE.Vector3().setScalar(chestPlacement.scale));
  for (const [width, height] of [[3440,1440], [2560,1080], [1920,1080], [1366,1024], [1024,1366], [768,1024],
    [360,800], [390,844], [393,852], [430,932], [480,1040], [844,390]]) {
    const preset = sceneConfig.layout[selectSceneLayout(width, height)];
    const camera = new THREE.PerspectiveCamera(preset.fov, width / height, 0.1, 350);
    const base = new THREE.Vector3(preset.cameraX, preset.height, preset.distance);
    camera.position.copy(base); camera.lookAt(preset.cameraX, preset.targetY, 0);
    const m = chestMotionBounds();
    const motion = new THREE.Box3(new THREE.Vector3(m.minX, m.minY, m.minZ),
      new THREE.Vector3(m.maxX, m.maxY, m.maxZ)).expandByScalar(0.03);
    keepBoundsInView(motion, matrix, camera, width, height);
    const end = camera.position.clone();
    camera.position.copy(base);
    const c = chestPose(0).bounds;
    keepBoundsInView(new THREE.Box3(new THREE.Vector3(c.minX,c.minY,c.minZ),
      new THREE.Vector3(c.maxX,c.maxY,c.maxZ)).expandByScalar(.03), matrix, camera, width, height);
    const start = camera.position.clone();
    let previous = start.clone();
    for (let step = 0; step <= 180; step++) {
      openingCameraPosition(start, end, step / 180, camera.position);
      camera.updateMatrixWorld();
      const b = chestPose(step / 180).bounds;
      const bounds = new THREE.Box3(new THREE.Vector3(b.minX, b.minY, b.minZ),
        new THREE.Vector3(b.maxX, b.maxY, b.maxZ)).expandByScalar(0.03);
      const projected = projectBounds(bounds, matrix, camera, width, height);
      assert.ok(projected.left >= 11.8 && projected.right <= width - 11.8,
        `${width}x${height}/${step}: ${JSON.stringify(projected)}`);
      assert.ok(projected.top >= 0 && projected.bottom <= height);
      assert.ok(camera.position.distanceTo(previous) <= start.distanceTo(end) * .011,
        "镜头只能沿连续缓动路径移动");
      previous.copy(camera.position);
    }
  }
});

// 与上一版真实纵深对照：后移应在宽屏中缩小约一成，并增加盒底与屏幕底边的距离。
test("receding chest gains widescreen breathing room without changing its physical scale", () => {
  for (const [width, height] of [[3440, 1440], [2560, 1080], [1920, 1080]]) {
    const preset = sceneConfig.layout.desktop;
    const camera = new THREE.PerspectiveCamera(preset.fov, width / height, 0.1, 350);
    camera.position.set(preset.cameraX, preset.height, preset.distance);
    camera.lookAt(preset.cameraX, preset.targetY, 0); camera.updateMatrixWorld();
    const pose = chestPose(0).bounds;
    const bounds = new THREE.Box3(new THREE.Vector3(pose.minX, pose.minY, pose.minZ),
      new THREE.Vector3(pose.maxX, pose.maxY, pose.maxZ));
    const projectAt = (z: number) => projectBounds(bounds, new THREE.Matrix4().compose(
      new THREE.Vector3(chestPlacement.x, 0, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
      new THREE.Vector3().setScalar(chestPlacement.scale)), camera, width, height);
    const previous = projectAt(7.8), current = projectAt(chestPlacement.z);
    const ratio = (current.right - current.left) / (previous.right - previous.left);
    assert.ok(ratio > 0.82 && ratio < 0.94, `${width}: 后移幅度应适中 ${ratio}`);
    assert.ok(current.bottom < previous.bottom - height * 0.025);
    assert.equal(chestPlacement.scale, 0.64);
  }
});
