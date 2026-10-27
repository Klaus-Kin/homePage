import * as THREE from "three";
import { chestPlacement, type ChestPlacement } from "./chest-placement.ts";

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
  // 宝盒投影加深，保留柔和半影；草坡远处的长草影由接收材质单独减淡。
  light.shadow.radius = 2.2;
  light.shadow.intensity = 0.94;
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

// 八个角点与临时坐标只创建一次；构图变化时拟合，静止帧不会扫描植被或重建几何。
const shadowCorner = new THREE.Vector3(), shadowVolume = new THREE.Box3();

/** 按整片近景的实际范围拟合阴影相机，覆盖宽屏两端，同时保持月球与主光共线。 */
export function fitMoonShadow(light: THREE.DirectionalLight, bounds: THREE.Box3) {
  // 使用投影通道本身的朝向计算光空间包围盒，避免把世界宽度误当作阴影相机宽度。
  light.shadow.updateMatrices(light);
  const camera = light.shadow.camera;
  shadowVolume.makeEmpty();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
    for (const z of [bounds.min.z, bounds.max.z]) {
      shadowCorner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      shadowVolume.expandByPoint(shadowCorner);
    }
  // 外围预留风摆与过滤半影的余量；深度范围同时包含坡面的阴影接收区域。
  const padding = 0.5;
  const next = {
    left: shadowVolume.min.x - padding, right: shadowVolume.max.x + padding,
    bottom: shadowVolume.min.y - padding, top: shadowVolume.max.y + padding,
    near: Math.max(0.1, -shadowVolume.max.z - padding), far: -shadowVolume.min.z + padding,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[])
    .some(key => Math.abs(camera[key] - next[key]) > 1e-8);
  if (changed) {
    Object.assign(camera, next);
    camera.updateProjectionMatrix();
    light.shadow.updateMatrices(light);
  }
  return changed;
}

/** 保留环境原有的漫反射构图，避免宝盒主光修正同时重画远山；接地阴影仍采样真实月光。 */
export function preserveLandscapeLight(group: THREE.Object3D) {
  const direction = { value: new THREE.Vector3() };
  // 阴影重点区域跟随响应式盒体位置；手机仍使用原坐标与原阴影强度。
  const shadowArea = { value: new THREE.Vector4(chestPlacement.x - 0.6, chestPlacement.z + 1.2, 2.7, 1.6) };
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
        let landscapeLights = THREE.ShaderChunk.lights_fragment_begin.replace(
            "getDirectionalLightInfo( directionalLight, directLight );",
            "getDirectionalLightInfo( directionalLight, directLight );\n directLight.direction = uLandscapeLightDirection;");
        if (material.name === "meadow-ground") {
          // 同一张真实阴影贴图在宝盒附近保持深度，远处草影柔和减淡；不会另画假阴影贴片。
          shader.uniforms.uChestShadowArea = shadowArea;
          shader.vertexShader = "varying vec3 vMeadowWorld;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>",
            "#include <worldpos_vertex>\n vMeadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
          shader.fragmentShader = `varying vec3 vMeadowWorld;
            uniform vec4 uChestShadowArea;
            float meadowShadowStrength(float maximum) {
              vec2 gap = max(abs(vMeadowWorld.xz - uChestShadowArea.xy) - uChestShadowArea.zw, vec2(0.0));
              float focus = 1.0 - smoothstep(0.0, 2.3, length(gap));
              return mix(min(maximum, 0.48), maximum, focus);
            }\n` + shader.fragmentShader;
          landscapeLights = landscapeLights.replaceAll("directionalLightShadow.shadowIntensity",
            "meadowShadowStrength(directionalLightShadow.shadowIntensity)");
        }
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>", landscapeLights);
      };
      material.customProgramCacheKey = () => `${cacheKey}:landscape-light-v2:${material.name}`;
    }
  });
  // 灯光计算发生在观察空间；视差和开盖镜头改变后同步方向，不把光固定在屏幕上。
  return (camera: THREE.Camera, placement: ChestPlacement = chestPlacement) => {
    direction.value.copy(originalDirection).transformDirection(camera.matrixWorldInverse);
    shadowArea.value.set(placement.x - 0.6, placement.z + 1.2, 2.7, 1.6);
  };
}
