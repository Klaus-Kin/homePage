import * as THREE from "three";

/** 草叶与投影共用同一风场；深度材质由场景初始化器单独登记并释放。 */
export function createGrassMaterials() {
  const wind = { value: 0 }, windStrength = { value: 1 };
  const material = new THREE.MeshStandardMaterial({
    color: 0xb3bc83, emissive: 0x182413, emissiveIntensity: 0.25,
    roughness: 1, side: THREE.DoubleSide,
  });
  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide,
  });
  const applyWind: THREE.Material["onBeforeCompile"] = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.uniforms.uWindStrength = windStrength;
    shader.vertexShader = "uniform float uWindTime; uniform float uWindStrength;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      `#include <begin_vertex>
      transformed.x += sin(uWindTime * 1.4 + instanceMatrix[3].x * 0.8 + instanceMatrix[3].z) * position.y * position.y * 0.24 * uWindStrength;`);
  };
  material.onBeforeCompile = depth.onBeforeCompile = applyWind;
  let shadowTime = -Infinity, previousReduced: boolean | undefined;
  return {
    material, depth,
    update(time: number, reduced: boolean) {
      wind.value = time;
      windStrength.value = reduced ? 0 : 1;
      // 风场缓慢变化，阴影最多每秒更新 20 次；减少动态模式仅在状态切换时重绘。
      const changed = previousReduced !== reduced || (!reduced && time - shadowTime >= 0.05);
      previousReduced = reduced;
      if (changed) shadowTime = time;
      return changed;
    },
  };
}
