import * as THREE from "three";
import { sceneConfig, selectSceneLayout } from "./config.ts";

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

/** 视口适配时确定给定边界的取景端点，不在开盖过程中按出界阈值追踪修正相机。
 * 先沿视线退到能容纳模型的最近距离，再水平平移；盒体与铰链始终固定在地面上。
 * 调用方在视口变化时从构图预设恢复相机，避免重复调用累积退远或平移。
 */
export function keepBoundsInView(bounds: THREE.Box3, matrix: THREE.Matrix4,
  camera: THREE.PerspectiveCamera, width: number, height: number) {
  // 近景上盖刚抬起时透视宽度会略增；端点多留一圈余量，连续镜头无需追边。
  const margin = 24, available = Math.max(1, width - margin * 2);
  const center = bounds.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const point = new THREE.Vector3();
  for (let pass = 0; pass < 4; pass++) {
    camera.updateMatrixWorld();
    const projected = projectBounds(bounds, matrix, camera, width, height);
    const depth = -point.copy(center).applyMatrix4(camera.matrixWorldInverse).z;
    const span = projected.right - projected.left;
    if (span > available) {
      // 留一点深度余量抵消盒体前后角的透视差，下一轮再精确核对两端。
      camera.position.addScaledVector(forward, -depth * (span / available - 1) * 1.03);
      continue;
    }
    const overflow = projected.left < margin ? projected.left - margin
      : projected.right > width - margin ? projected.right - width + margin : 0;
    // 前移后的近景也需要底部留白；沿相机上方向平移，保留既定俯角与模型比例。
    const vertical = projected.top < margin ? projected.top - margin
      : projected.bottom > height - margin ? projected.bottom - height + margin : 0;
    if (Math.abs(overflow) < 0.1 && Math.abs(vertical) < 0.1) break;
    const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth / height;
    camera.position.x += overflow * worldPerPixel;
    camera.position.addScaledVector(up, -vertical * worldPerPixel);
  }
  camera.updateMatrixWorld();
}

/** 两个取景端点都在视口适配时确定；五次缓动使开盖前后速度与加速度均为零，避免点击时突跳。 */
export function openingCameraPosition(start: THREE.Vector3, end: THREE.Vector3,
  progress: number, result = new THREE.Vector3()) {
  const p = Math.max(0, Math.min(1, progress));
  const ease = p * p * p * (p * (p * 6 - 15) + 10);
  return result.copy(start).lerp(end, ease);
}
