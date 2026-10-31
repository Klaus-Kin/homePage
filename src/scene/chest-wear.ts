import * as THREE from "three";
import { noise } from "./terrain-math.ts";

/** 每块木板携带自身尺寸，使磨损沿真实三维转角分布，不随贴图或刻字方向重复。 */
export function wornWoodGeometry(width: number, height: number, depth: number, radius: number) {
  // 沿长边保留足够采样点，让少量磕口真正改变轮廓；分段仅在初始化生成。
  const geometry = new THREE.BoxGeometry(width, height, depth,
    Math.ceil(width / 0.065), Math.ceil(height / 0.055), Math.ceil(depth / 0.055));
  const positions = geometry.getAttribute("position");
  const half = new THREE.Vector3(width / 2, height / 2, depth / 2);
  const core = half.clone().subScalar(radius);
  const coreMin = core.clone().negate();
  const point = new THREE.Vector3(), nearest = new THREE.Vector3(), outward = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    nearest.copy(point).clamp(coreMin, core);
    outward.copy(point).sub(nearest).normalize();
    const distances = [half.x - Math.abs(point.x), half.y - Math.abs(point.y), half.z - Math.abs(point.z)]
      .sort((a, b) => a - b);
    // 磕损只向木板内部收缩，第二近表面把它限制在转角；不侵入完整面板与雕字。
    const edge = 1 - THREE.MathUtils.smoothstep(distances[1], 0.002, 0.026);
    const patch = noise(point.x * 23 + point.z * 17 + width * 3.1, point.y * 31 + depth * 7.3);
    const dent = edge * THREE.MathUtils.smoothstep(patch, 0.61, 0.84) * 0.014;
    point.copy(nearest).addScaledVector(outward, radius - dent);
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  const count = geometry.getAttribute("position").count;
  const extent = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    extent.set([width / 2, height / 2, depth / 2], i * 3);
  }
  geometry.setAttribute("chestHalfSize", new THREE.BufferAttribute(extent, 3));
  return geometry;
}

/** 保留原材质和刻字扫光；只在边缘窄带内加入稀疏露木、浅凹痕与粗糙反光。 */
export function addChestWear(material: THREE.MeshStandardMaterial) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.vertexShader = `attribute vec3 chestHalfSize;
varying vec3 vChestPosition;
varying vec3 vChestHalfSize;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vChestPosition = position;
vChestHalfSize = chestHalfSize;`);
    shader.fragmentShader = `varying vec3 vChestPosition;
varying vec3 vChestHalfSize;
// 连续的三维噪声让相邻面的磕痕跨转角衔接，避免贴图接缝和均匀描边。
float chestWearHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float chestWearNoise(vec3 p) {
  vec3 cell = floor(p), t = fract(p);
  t = t * t * (3.0 - 2.0 * t);
  return mix(mix(mix(chestWearHash(cell), chestWearHash(cell + vec3(1,0,0)), t.x),
                 mix(chestWearHash(cell + vec3(0,1,0)), chestWearHash(cell + vec3(1,1,0)), t.x), t.y),
             mix(mix(chestWearHash(cell + vec3(0,0,1)), chestWearHash(cell + vec3(1,0,1)), t.x),
                 mix(chestWearHash(cell + vec3(0,1,1)), chestWearHash(cell + vec3(1,1,1)), t.x), t.y), t.z);
}
${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
// 到第二近表面的距离限定转角窄带，面板中央与字槽不参与旧化。
vec3 chestDistance = max(vChestHalfSize - abs(vChestPosition), vec3(0.0));
float chestEdgeDistance = min(max(chestDistance.x, chestDistance.y),
  min(max(chestDistance.y, chestDistance.z), max(chestDistance.x, chestDistance.z)));
float chestEdge = 1.0 - smoothstep(0.002, 0.021, chestEdgeDistance);
vec3 chestPoint = vChestPosition + vChestHalfSize * vec3(3.1, 5.7, 7.3);
float chestPatch = smoothstep(0.48, 0.72, chestWearNoise(chestPoint * 19.0));
float chestFibre = chestWearNoise(chestPoint * vec3(85.0, 145.0, 125.0));
float chestWear = chestEdge * chestPatch * smoothstep(0.28, 0.72, chestFibre);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.205, 0.155), chestWear * 0.65);
float chestDent = chestWear * 0.003;
`).replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
// 复用木纹已有的凹凸法线函数，使浅磕痕随月光改变明暗，而非贴上发亮斑点。
normal = perturbNormalArb(-vViewPosition, normal,
  vec2(dFdx(chestDent), dFdy(chestDent)), faceDirection);`);
  };
  // 旧化与刻字使用独立缓存键，避免共享木材时误用未注入边缘属性的着色器。
  material.customProgramCacheKey = () => `${previousKey}:chest-edge-wear-v1`;
}
