import * as THREE from "three";
import { sceneConfig, selectSceneLayout } from "./config";

/** 横屏手机仍使用轻量画质，但构图切换为左右布局。 */
export function fitCamera(
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  host: HTMLElement,
) {
  const width = Math.max(1, host.clientWidth),
    height = Math.max(1, host.clientHeight);
  const mobile =
    width < 768 || height < 500 || matchMedia("(pointer: coarse)").matches;
  // 选择构图时同时考虑可用横向空间，避免大尺寸竖屏套用偏右的桌面相机。
  const name = selectSceneLayout(width, height);
  const preset = sceneConfig.layout[name];
  camera.aspect = width / height;
  camera.fov = preset.fov;
  camera.position.set(preset.cameraX, preset.height, preset.distance);
  camera.lookAt(preset.cameraX, preset.targetY, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  renderer.setPixelRatio(
    Math.min(
      window.devicePixelRatio || 1,
      sceneConfig.quality[mobile ? "mobile" : "desktop"].pixelRatio,
    ),
  );
  renderer.setSize(width, height, false);
  return { width, height, mobile, preset, name };
}

/** 把屏幕构图点还原到空间，月球与云片仍是独立 3D 对象。 */
export function screenPoint(
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  distance: number,
) {
  const point = new THREE.Vector3(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera);
  const direction = point.sub(camera.position).normalize();
  const forward = camera.getWorldDirection(new THREE.Vector3());
  return camera.position
    .clone()
    .addScaledVector(direction, distance / direction.dot(forward));
}

/** 复用局部包围盒的八角投影，避免动画中遍历模型或读取 DOM 尺寸。 */
export function projectBounds(
  bounds: THREE.Box3,
  matrix: THREE.Matrix4,
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  const point = new THREE.Vector3();
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        point.set(x, y, z).applyMatrix4(matrix).project(camera);
        const px = ((point.x + 1) * width) / 2,
          py = ((1 - point.y) * height) / 2;
        left = Math.min(left, px);
        right = Math.max(right, px);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py);
      }
  return { left, right, top, bottom };
}
