import * as THREE from "three";

/** 草叶与投影共用同一风场；深度材质由场景初始化器单独登记并释放。 */
export function createGrassMaterials(options: { strength?: number; flower?: boolean } = {}) {
  const wind = { value: 0 }, windStrength = { value: 1 };
  const material = new THREE.MeshStandardMaterial({
    // 草叶色来自实例及叶身顶点，花株色来自完整几何；月夜亮部完全接受场景灯光。
    color: 0xffffff, emissiveIntensity: 0, vertexColors: true,
    roughness: .86, side: THREE.DoubleSide,
  });
  material.name = options.flower ? "meadow-flowers" : "meadow-foliage";
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
  material.onBeforeCompile = (shader, renderer) => {
    applyWind(shader, renderer);
    if (!options.flower) {
      // 薄叶透光仍乘上真实光色及阴影衰减，月光被挡住时不会自亮；花瓣保持普通粗糙材质。
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          float leafTransmission = 0.12 + 0.12 * pow(1.0 - abs(dot(geometryNormal, directLight.direction)), 2.0);
          reflectedLight.directDiffuse += material.diffuseColor * directLight.color * leafTransmission * RECIPROCAL_PI;
        #endif`);
    }
  };
  // 不同强度复用程序，花瓣关闭透光时使用独立程序，避免编译缓存交叉污染。
  material.customProgramCacheKey = () => `meadow-wind-v1:${Boolean(options.flower)}`;
  let shadowTime = -Infinity, previousReduced: boolean | undefined;
  return {
    material, depth,
    update(time: number, reduced: boolean) {
      wind.value = time;
      windStrength.value = reduced ? 0 : (options.strength ?? 1);
      // 风场缓慢变化，阴影最多每秒更新 20 次；减少动态模式仅在状态切换时重绘。
      const changed = previousReduced !== reduced || (!reduced && time - shadowTime >= 0.05);
      previousReduced = reduced;
      if (changed) shadowTime = time;
      return changed;
    },
  };
}
