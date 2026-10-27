import * as THREE from "three";

// 复用临时向量，月球、相机与开盖更新时不逐帧创建对象。
const source = new THREE.Vector3(), position = new THREE.Vector3();

/** 近景阴影覆盖闭盒、立盖和展开落点；保持原有冷月光色与强度。 */
export function createMoonLight() {
  const light = new THREE.DirectionalLight(0xb3ceff, 2);
  light.castShadow = true;
  Object.assign(light.shadow.camera, {
    left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 60,
  });
  // 薄木板和铰链需要较小的法线偏移，否则接地阴影和自遮挡会被抹掉。
  light.shadow.normalBias = 0.006;
  light.shadow.bias = -0.00006;
  return light;
}

/** 月球是唯一的主光方向依据；把平行光移到宝盒附近只为集中阴影精度，不改变光向。 */
export function syncMoonLight(light: THREE.DirectionalLight, moon: THREE.Object3D, target: THREE.Vector3) {
  moon.getWorldPosition(source);
  position.copy(source).sub(target).normalize().multiplyScalar(30).add(target);
  const changed = light.position.distanceToSquared(position) > 1e-12
    || light.target.position.distanceToSquared(target) > 1e-12;
  if (changed) {
    light.position.copy(position);
    light.target.position.copy(target);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  }
  return changed;
}

/** 保留环境原有的漫反射构图，避免宝盒主光修正同时重画远山；接地阴影仍采样真实月光。 */
export function preserveLandscapeLight(group: THREE.Object3D) {
  const direction = { value: new THREE.Vector3() };
  const originalDirection = new THREE.Vector3(8, 14, -6).normalize();
  const materials = new Set<THREE.MeshStandardMaterial>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || materials.has(material)) continue;
      materials.add(material);
      // 包装既有编译回调，草叶风动等顶点变形仍沿用原实现。
      const compile = material.onBeforeCompile;
      const cacheKey = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        shader.uniforms.uLandscapeLightDirection = direction;
        shader.fragmentShader = "uniform vec3 uLandscapeLightDirection;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>",
          THREE.ShaderChunk.lights_fragment_begin.replace(
            "getDirectionalLightInfo( directionalLight, directLight );",
            "getDirectionalLightInfo( directionalLight, directLight );\n directLight.direction = uLandscapeLightDirection;"));
      };
      material.customProgramCacheKey = () => `${cacheKey}:landscape-light-v1`;
    }
  });
  // 灯光计算发生在观察空间；视差和开盖镜头改变后同步方向，不把光固定在屏幕上。
  return (camera: THREE.Camera) => {
    direction.value.copy(originalDirection).transformDirection(camera.matrixWorldInverse);
  };
}
