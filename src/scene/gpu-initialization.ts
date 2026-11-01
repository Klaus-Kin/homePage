import * as THREE from "three";
import type { Initialization } from "./initialization.ts";

// 缓存跟随初始化生命周期，以实际对象和保守状态签名去重；不跨 WebGL 上下文复用编译结果。
interface WarmupCache {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  compiled: WeakMap<THREE.Object3D, Set<string>>;
  submitted: WeakMap<THREE.Object3D, Set<string>>;
}
const warmupCaches = new WeakMap<Initialization, WarmupCache[]>();
const resourceIds = new WeakMap<object, number>();
let nextResourceId = 0;

function resourceId(resource: object) {
  if (!resourceIds.has(resource)) resourceIds.set(resource, ++nextResourceId);
  return resourceIds.get(resource);
}

/** 只记录绘制输入，避免把 GPU 内部缓存和循环引用写入签名；资源用身份及版本追踪。 */
function inputKey(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value !== "object") return typeof value === "function" ? String(value) : String(value);
  if (seen.has(value)) return "cycle";
  seen.add(value);
  if (value instanceof THREE.Texture) return [value.uuid, value.version, value.source.version,
    value.colorSpace, value.mapping, value.wrapS, value.wrapT, value.magFilter, value.minFilter,
    value.anisotropy, value.flipY, value.matrix.elements, value.offset.toArray(), value.repeat.toArray(), value.rotation].join(":");
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>).join(",");
  if (Array.isArray(value)) return value.map(entry => inputKey(entry, new Set(seen))).join(",");
  return Object.entries(value).filter(([key]) => !key.startsWith("_") && key !== "uuid")
    .map(([key, entry]) => `${key}:${inputKey(entry, new Set(seen))}`).join(";");
}

function materialKey(material?: THREE.Material | THREE.Material[]): string {
  if (!material) return "";
  if (Array.isArray(material)) return material.map(entry => materialKey(entry)).join("|");
  return `${material.uuid}:${inputKey(material)}:${material.customProgramCacheKey()}`;
}

function geometryKey(geometry?: THREE.BufferGeometry): string {
  if (!geometry) return "";
  const attributes = Object.entries(geometry.attributes).map(([name, attribute]) =>
    `${name}:${resourceId(attribute)}:${attribute.count}:${attribute.itemSize}:${attribute.normalized}:${"version" in attribute ? attribute.version : attribute.data.version}`);
  return `${geometry.uuid}:${geometry.index ? resourceId(geometry.index) : ""}:${geometry.index?.version}:${geometry.drawRange.start}:${geometry.drawRange.count}:${inputKey(geometry.groups)}:${attributes}:${inputKey(geometry.morphAttributes)}`;
}

function objectKey(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh, instances = object as THREE.InstancedMesh;
  return [object.matrixWorld.elements.join(","), object.castShadow, object.receiveShadow, object.renderOrder,
    object.frustumCulled, geometryKey(mesh.geometry), materialKey(mesh.material), materialKey(mesh.customDepthMaterial),
    materialKey(mesh.customDistanceMaterial), instances.count, instances.instanceMatrix ? resourceId(instances.instanceMatrix) : "", instances.instanceMatrix?.version,
    instances.instanceColor ? resourceId(instances.instanceColor) : "", instances.instanceColor?.version, inputKey(mesh.morphTargetInfluences),
    inputKey((object as THREE.SkinnedMesh).skeleton?.boneMatrices)].join("/");
}

/** 自定义回调可能捕获外部 uniform；无法完整观测的输入保守地每次提交，不能凭函数文本推断未变。 */
function canCacheSubmission(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  const materials = [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial]
    .flatMap(material => Array.isArray(material) ? material : material ? [material] : []);
  return object.onBeforeRender === THREE.Object3D.prototype.onBeforeRender && materials.every(material =>
    material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
    material.onBeforeRender === THREE.Material.prototype.onBeforeRender);
}

/** 完整提交缓存同时覆盖灯光 uniform、阴影投影体、相机、材质、缓冲及世界变换。 */
function submissionState(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const inputs: string[] = [];
  scene.traverseVisible(object => {
    if (!object.layers.test(camera.layers)) return;
    if (object instanceof THREE.Light) {
      const light = object as THREE.SpotLight;
      light.target?.updateWorldMatrix(true, false);
      inputs.push(`${light.uuid}:${light.matrixWorld.elements}:${inputKey(light.color)}:${light.intensity}:${light.castShadow}:${light.distance}:${light.decay}:${light.angle}:${light.penumbra}:${inputKey(light.map)}:${light.target?.matrixWorld.elements}:${inputKey((object as THREE.HemisphereLight).groundColor)}`);
      if (light.shadow) inputs.push(inputKey({ bias: light.shadow.bias, normalBias: light.shadow.normalBias,
        radius: light.shadow.radius, mapSize: light.shadow.mapSize, projection: light.shadow.camera.projectionMatrix }));
    }
    if (object.castShadow) inputs.push(`caster:${object.uuid}:${objectKey(object)}`);
  });
  const viewport = renderer.getViewport?.(new THREE.Vector4()).toArray(), scissor = renderer.getScissor?.(new THREE.Vector4()).toArray();
  const target = renderer.getRenderTarget?.();
  const background = `${inputKey(scene.background)}:${scene.backgroundBlurriness}:${scene.backgroundIntensity}:${scene.backgroundRotation.toArray()}`;
  const clear = `${inputKey(renderer.getClearColor?.(new THREE.Color()))}:${renderer.getClearAlpha?.()}:${renderer.autoClear}:${renderer.autoClearColor}:${renderer.autoClearDepth}:${renderer.autoClearStencil}`;
  return `${inputs.join("|")}|${inputKey(scene.fog)}:${inputKey(scene.environment)}:${scene.environmentIntensity}:${scene.environmentRotation.toArray()}:${materialKey(scene.overrideMaterial ?? undefined)}|${camera.matrixWorld.elements}:${camera.projectionMatrix.elements}:${camera.layers.mask}|${renderer.shadowMap.enabled}:${renderer.shadowMap.type}:${renderer.toneMapping}:${renderer.toneMappingExposure}:${renderer.outputColorSpace}:${renderer.localClippingEnabled}:${inputKey(renderer.clippingPlanes)}:${viewport}:${scissor}:${renderer.getScissorTest?.()}:${renderer.getPixelRatio?.()}:${target ? resourceId(target) : "default"}:${background}:${clear}`;
}

function compilationKey(object: THREE.Object3D, state: string) {
  const drawable = object as THREE.Mesh;
  const materials = Array.isArray(drawable.material) ? drawable.material : drawable.material ? [drawable.material] : [];
  // 材质版本及自定义着色器键改变时必须重新编译；几何与对象身份保持独立，避免误合并蒙皮或实例对象。
  return `${state}|${drawable.geometry?.uuid}|${object.receiveShadow}|${materials.map(material =>
    `${material.uuid}:${material.version}:${material.customProgramCacheKey()}`).join("|")}`;
}

/** 先逐张上传纹理，把上传与着色器、几何的首次提交拆开；包含暂时隐藏的开盖和提示资源。 */
export async function initializeTextures(renderer: THREE.WebGLRenderer, scene: THREE.Scene, init: Initialization) {
  const uploadStart = performance.now();
  const textures=new Set<THREE.Texture>();
  scene.traverse(object=>{
    const material=(object as THREE.Mesh).material;
    for(const entry of Array.isArray(material)?material:material?[material]:[]) {
      for(const value of Object.values(entry)) if(value instanceof THREE.Texture) textures.add(value);
      if(entry instanceof THREE.ShaderMaterial) {
        for(const uniform of Object.values(entry.uniforms)) if(uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
    }
  });
  init.phase="gpu-textures";
  await init.checkpoint(true);
  for(const texture of textures) {
    init.check();
    const start=performance.now();
    renderer.initTexture(texture);
    performance.measure("moon-gpu-texture-upload",{start,end:performance.now()});
    await init.checkpoint(true);
  }
  // 阶段墙钟包含任务调度，逐张上传的 CPU 时间仍由原有细粒度测量保留。
  performance.measure("moon-gpu-textures", { start: uploadStart, end: performance.now() });
}

/** 在真实场景灯光、阴影和材质组合下逐对象首次绘制；异常或取消时也完整恢复可见性。 */
export async function warmScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  camera: THREE.Camera, init: Initialization) {
  const warmupStart = performance.now(), phase = init.phase;
  const caches = warmupCaches.get(init) ?? [];
  if (!warmupCaches.has(init)) init.cleanup(() => warmupCaches.delete(init));
  warmupCaches.set(init, caches);
  let cache = caches.find(entry => entry.renderer === renderer && entry.scene === scene && entry.camera === camera);
  if (!cache) {
    cache = { renderer, scene, camera, compiled: new WeakMap(), submitted: new WeakMap() };
    caches.push(cache);
  }
  // 灯光只记录参与当前相机的可见集合；亮度和位置属于 uniform，不影响已编译组合。
  const lights: string[] = [];
  scene.traverseVisible(object => {
    if (object instanceof THREE.Light && object.layers.test(camera.layers))
      lights.push(`${object.uuid}:${object.castShadow}:${object instanceof THREE.SpotLight ? object.map?.uuid : ""}`);
  });
  const state = `${lights.sort().join(",")}|${scene.fog?.constructor.name}|${scene.environment?.uuid}|${renderer.shadowMap.enabled}:${renderer.shadowMap.type}`;
  const objects: THREE.Object3D[]=[],layers=new Map<THREE.Object3D,number>();
  scene.traverse(object=>{
    if(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
      objects.push(object);layers.set(object,object.layers.mask);
    }
  });
  const active=new Set<THREE.Object3D>();
  scene.traverseVisible(object=>{if(layers.has(object)) active.add(object);});
  const shadowInputsKnown = [...active].every(object => !object.castShadow || canCacheSubmission(object));
  // 存在不可观测的阴影回调时整轮都不能复用提交；不再为这些必绘对象构建昂贵的状态快照。
  const drawingState = shadowInputsKnown ? submissionState(renderer, scene, camera) : "";
  try {
    await init.checkpoint(true);
    // 仅关闭对象自身的绘制层，不隐藏父网格，保证其子网格仍能独立参与预热。
    objects.forEach(object=>{object.layers.mask=0;});
    let firstSubmission = true;
    for(const object of active) {
      init.check();
      const cacheable = shadowInputsKnown && canCacheSubmission(object);
      const submissionKey = cacheable ? `${drawingState}|${layers.get(object)}|${objectKey(object)}` : "";
      // 只跳过实际成功绘制过的相同状态；编译成功不代表几何、深度材质和 uniform 已提交。
      if (cacheable && cache.submitted.get(object)?.has(submissionKey)) continue;
      object.layers.mask=layers.get(object)!;
      // 编译目标限制到当前对象，第三个参数仍提供完整场景的实际灯光、雾和环境。
      const key = compilationKey(object, state);
      if (!cache.compiled.get(object)?.has(key)) {
        const compileStart=performance.now();
        const compilation=renderer.compileAsync(object,camera,scene);
        performance.measure("moon-gpu-object-compile-call",{start:compileStart,end:performance.now()});
        // 记录同步编译调用后等待驱动完成；异步等待不计入应用 CPU 批次。
        // 等待本身保留同步调用已用的预算；完成后按预算让出，不再为每个对象强制排队三次。
        await init.waitFor(compilation);
        init.check();
        // Three.js 编译会遍历目标的全部子对象，连隐藏子网格也已完成；记录它们以免随后重复请求。
        object.traverse(child => {
          const completed = cache!.compiled.get(child) ?? new Set<string>();
          completed.add(compilationKey(child, state));
          cache!.compiled.set(child, completed);
        });
      }
      init.check();
      const beforeSubmit = init.checkpoint(); if (beforeSubmit) await beforeSubmit;
      // 每个预热状态首次准备阴影，其后只为投影物体更新，保证深度材质和几何仍在门禁内提交。
      renderer.shadowMap.needsUpdate=firstSubmission || object.castShadow;
      const start=performance.now();
      renderer.render(scene,camera);
      performance.measure("moon-gpu-object-submit",{start,end:performance.now()});
      init.check();
      if (cacheable) {
        const completed = cache.submitted.get(object) ?? new Set<string>();
        completed.add(submissionKey); cache.submitted.set(object, completed);
      }
      firstSubmission = false;
      object.layers.mask=0;
      const afterSubmit = init.checkpoint(); if (afterSubmit) await afterSubmit;
    }
  } finally {
    layers.forEach((value,object)=>{object.layers.mask=value;});
    renderer.shadowMap.needsUpdate=true;
    // 保留四轮预热各自的墙钟耗时，便于与下载、生成和首次点击逐项对照。
    performance.measure(`moon-${phase}`, { start: warmupStart, end: performance.now() });
  }
}
