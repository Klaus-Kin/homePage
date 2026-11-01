import * as THREE from "three";

/** 岩壁用连续空间噪声刻出竖向冲沟与交错断层；不增加纹理、透明片或移动端几何。 */
export function addMountainSurface(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vMountainPoint;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vMountainPoint = position;`);
    // 声明末尾保留换行，避免与 Three.js 的预处理宏拼接。
    shader.fragmentShader = `varying vec3 vMountainPoint;
float mountainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float mountainNoise(vec2 p) {
  vec2 cell=floor(p), t=fract(p); t=t*t*(3.0-2.0*t);
  return mix(mix(mountainHash(cell),mountainHash(cell+vec2(1,0)),t.x),
    mix(mountainHash(cell+vec2(0,1)),mountainHash(cell+vec2(1,1)),t.x),t.y);
}
${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
// 沟壑随高度缓慢偏转，横向细断层穿过主沟；阴暗处保留冷蓝反射。
vec3 rockPoint = vMountainPoint;
float rockWarp = mountainNoise(rockPoint.xz * .34);
vec2 rockDomain = vec2(rockPoint.x * 2.8 + rockWarp * 2.5 + rockPoint.y * .22,
  rockPoint.z * 1.6 + rockPoint.y * .14);
float rockRidge = 1.0 - abs(mountainNoise(rockDomain) * 2.0 - 1.0);
float rockFine = mountainNoise(rockDomain * 3.7 + rockPoint.y * .4);
float rockCrack = pow(rockRidge, 14.0);
float rockStratum = mountainNoise(vec2(rockPoint.x * 1.4 + rockWarp, rockPoint.y * 7.0));
float rockRelief = rockRidge * .22 + rockFine * .065 - rockCrack * .06 + rockStratum * .025;
diffuseColor.rgb *= .82 + rockRidge * .85 + rockFine * .24 - rockCrack * .38;
`).replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
// 屏幕导数使沟壑参与实际月光，远处自动随像素足迹平滑，不靠细碎高亮描线。
normal = perturbNormalArb(-vViewPosition, normal,
  vec2(dFdx(rockRelief), dFdy(rockRelief)), faceDirection);`);
  };
  material.customProgramCacheKey = () => "mountain-eroded-rock-v1";
}
