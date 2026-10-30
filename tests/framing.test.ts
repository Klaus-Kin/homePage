import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { keepBoundsInView, projectBounds, openingCameraPosition, fitChoiceCamera } from "../src/responsive.ts";
import { sceneConfig, selectSceneLayout } from "../src/config.ts";
import { chestPlacement, selectChestPlacement } from "../src/scene/chest-placement.ts";
import { chestPose, chestMotionBounds } from "../src/scene/chest-motion.ts";
import { choiceFrame, choiceGroundOffset } from "../src/choice-prompt.ts";

// 近景和展开端点预先适配；连续采样检查模型完整可见与镜头轨迹，不再等到出界才跳动修正。
test("foreground chest stays visible through continuously planned opening framing", () => {
  for (const [width, height] of [[3440,1440], [2560,1080], [1920,1080], [1366,1024], [1024,1366], [768,1024],
    [360,800], [390,844], [393,852], [430,932], [480,1040], [844,390]]) {
    // 与真实场景一致，手机横屏仍沿用已确认的位置，桌面检查新坐标。
    const placement = selectChestPlacement(width < 768 || height < 500);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(placement.x, 0, placement.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
      new THREE.Vector3().setScalar(placement.scale));
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

// 复现 320x480 的上盖覆盖第二入口；仅短小屏允许取景退让，实体比例与姿态不变。
test("short portrait prompt framing clears both entries while retaining the full 26 degree opening", () => {
  for (const [width,height,bottom] of [[320,480,354.3],[320,500,368],[640,600,390],[768,721,565],[800,721,565],[768,841,666.4],[1024,800,636]]) {
    const p = selectChestPlacement(width<768), preset = sceneConfig.layout[selectSceneLayout(width,height)];
    const camera = new THREE.PerspectiveCamera(preset.fov,width/height,.1,350);
    camera.position.set(preset.cameraX,preset.height,preset.distance); camera.lookAt(preset.cameraX,preset.targetY,0);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x,0,p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI),new THREE.Vector3().setScalar(p.scale));
    const c=chestPose(0).bounds;
    keepBoundsInView(new THREE.Box3(new THREE.Vector3(c.minX,c.minY,c.minZ),new THREE.Vector3(c.maxX,c.maxY,c.maxZ)).expandByScalar(.03),matrix,camera,width,height);
    const start=camera.position.clone();
    const b=chestPose(26/180).bounds;
    const peak=new THREE.Box3(new THREE.Vector3(b.minX,b.minY,b.minZ),new THREE.Vector3(b.maxX,b.maxY,b.maxZ)).expandByScalar(.16);
    const active=fitChoiceCamera(peak,matrix,camera,width,height,{left:20,right:width-20,bottom});
    const projection=projectBounds(peak,matrix,camera,width,height);
    if (active) {
      assert.ok(projection.top>=bottom+13.9,JSON.stringify(projection));
      assert.ok(projection.bottom<=height-17.9,JSON.stringify(projection));
      const end=camera.position.clone();
      // 同时检查退让与回程的连续样本，不能只验证完全打开时的安全端点。
      for (let ms=0;ms<=1800;ms+=10) {
        const f=choiceFrame(ms),pose=chestPose(f.lid/Math.PI).bounds;
        const support=choiceGroundOffset(f.pitch,Math.PI+f.yaw,f.roll);
        const currentMatrix=new THREE.Matrix4().compose(new THREE.Vector3(p.x,(support+f.lift)*p.scale,p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch,Math.PI+f.yaw,f.roll)),new THREE.Vector3().setScalar(p.scale));
        camera.position.copy(start).lerp(end,f.framing);camera.updateMatrixWorld();
        const current=new THREE.Box3(new THREE.Vector3(pose.minX,pose.minY,pose.minZ),new THREE.Vector3(pose.maxX,pose.maxY,pose.maxZ)).expandByScalar(.03);
        const projected=projectBounds(current,currentMatrix,camera,width,height);
        assert.ok(projected.top>=bottom+9.9,`${width}x${height}/${ms}: ${JSON.stringify(projected)}`);
        assert.ok(projected.bottom<=height,`${width}x${height}/${ms}: ${JSON.stringify(projected)}`);
      }
    }
  }
  const camera=new THREE.PerspectiveCamera(42,1920/601,.1,350), before=camera.position.clone();
  assert.equal(fitChoiceCamera(new THREE.Box3(new THREE.Vector3(-1,0,0),new THREE.Vector3(1,2,1)),new THREE.Matrix4(),camera,1920,601,{left:0,right:600,bottom:600}),false);
  assert.deepEqual(camera.position,before);
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
    const projectAt = (x: number, z: number) => projectBounds(bounds, new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
      new THREE.Vector3().setScalar(chestPlacement.scale)), camera, width, height);
    const desktop = selectChestPlacement(false);
    const previous = projectAt(chestPlacement.x, chestPlacement.z), current = projectAt(desktop.x, desktop.z);
    const ratio = (current.right - current.left) / (previous.right - previous.left);
    assert.ok(ratio > 0.78 && ratio < 0.90, `${width}: 后移幅度应适中 ${ratio}`);
    assert.ok((current.left + current.right) / 2 < (previous.left + previous.right) / 2 - width * .025);
    assert.ok(current.bottom < previous.bottom - height * 0.025);
    assert.equal(chestPlacement.scale, 0.64);
  }
});
