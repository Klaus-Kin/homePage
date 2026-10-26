import * as THREE from "three";
import { fitCamera, projectBounds } from "./responsive";
import { sceneConfig } from "./config";
import { createChest } from "./scene/chest";
import { createTerrain } from "./scene/terrain";
import { createSky } from "./scene/sky";

export interface MoonScene {
  setHover(value: boolean): void;
  setTransition(value: number): void;
  setReducedMotion(value: boolean): void;
  setPointer(x: number, y: number): void;
  resize(): void;
  dispose(): void;
}

/** 协调器独占相机、灯光和生命周期；模块只负责各自的空间对象。 */
export async function createScene(
  host: HTMLElement,
  hitTarget: HTMLElement,
  onFailure: (error: unknown) => void,
): Promise<MoonScene> {
  // 月面解码完成后才创建和展示场景，避免白色占位球切换真实纹理造成第二次闪动。
  // 影像署名：NASA's Scientific Visualization Studio；LRO / LROC 月面颜色图。
  // 原始素材及使用信息：https://svs.gsfc.nasa.gov/4720/
  const lunarMap = await new THREE.TextureLoader().loadAsync(
    "/assets/moon-lroc.jpg",
  );
  lunarMap.colorSpace = THREE.SRGBColorSpace;
  lunarMap.anisotropy = 4;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // 地形、宝盒与主光都不移动，只在初始化和画质切换时更新阴影。
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x203552, 0.009);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 350);
  let disposed = false,
    frameCount = 0,
    recordResources = true;
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let hovered = false,
    transition = 0,
    time = 0,
    lastTime = 0;
  const pointer = new THREE.Vector2(),
    currentPointer = new THREE.Vector2();
  const baseCamera = new THREE.Vector3();
  const caption = document.querySelector<HTMLElement>(".box-caption")!;

  // 释放实例缓冲、共享纹理、阴影贴图和 WebGL 上下文；异常初始化也走同一路径。
  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    document.removeEventListener("visibilitychange", updateLoop);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Sprite
      ) {
        if (!(object instanceof THREE.Sprite)) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      }
      if (object instanceof THREE.Light && "shadow" in object)
        (object.shadow as THREE.LightShadow).dispose();
    });
    geometries.forEach((item) => item.dispose());
    materials.forEach((item) => item.dispose());
    textures.forEach((item) => item.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    onFailure(new Error("WebGL context lost"));
  }
  function updateLoop() {
    if (disposed) return;
    lastTime = performance.now();
    renderer.setAnimationLoop(!reduced && !document.hidden ? animate : null);
    render();
  }
  let chest: ReturnType<typeof createChest>,
    terrain: ReturnType<typeof createTerrain>,
    sky: ReturnType<typeof createSky>;
  let size: ReturnType<typeof fitCamera>;
  const boxBounds = new THREE.Box3(
    new THREE.Vector3(-1.84, -0.23, -0.84),
    new THREE.Vector3(1.84, 0.88, 0.94),
  );
  const moonBounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  const warmLight = new THREE.PointLight(0xffb34f, 12, 9, 2);
  warmLight.position.set(0, 0.8, 1.0);
  const backGlow = new THREE.PointLight(0xffbf66, 5, 7, 2);
  backGlow.position.set(0, 0.8, -0.8);
  const moonLight = new THREE.DirectionalLight(0xb3ceff, 2.0);
  moonLight.position.set(8, 14, -6);
  moonLight.castShadow = true;
  Object.assign(moonLight.shadow.camera, {
    left: -12,
    right: 12,
    top: 12,
    bottom: -12,
    near: 0.5,
    far: 40,
  });
  moonLight.shadow.normalBias = 0.018;
  moonLight.shadow.bias = -0.0001;

  function syncTargets() {
    camera.updateMatrixWorld();
    chest.box.updateMatrixWorld();
    sky.moon.updateMatrixWorld();
    const b = projectBounds(
      boxBounds,
      chest.box.matrixWorld,
      camera,
      size.width,
      size.height,
    );
    // 验收读取完整模型投影，而非已裁到视口内的按钮，避免把模型裁切误判为可见。
    host.dataset.boxBounds = JSON.stringify(b);
    const left = Math.max(0, b.left - 10),
      top = Math.max(0, b.top - 10);
    Object.assign(hitTarget.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.max(44, Math.min(size.width, b.right + 10) - left)}px`,
      height: `${Math.max(44, Math.min(size.height, b.bottom + 10) - top)}px`,
    });
    const captionWidth = Math.min(
      size.width - 24,
      size.name === "short" ? 270 : 350,
    );
    Object.assign(caption.style, {
      left: `${Math.min(size.width - captionWidth - 12, Math.max(12, (b.left + b.right - captionWidth) / 2))}px`,
      top: `${Math.min(size.height - (size.name === "short" ? 65 : 105), b.bottom + (size.name === "short" ? 15 : 32))}px`,
      width: `${captionWidth}px`,
    });
    // 只暴露投影和帧计数供验收，不向页面暴露场景修改接口。
    host.dataset.moonBounds = JSON.stringify(
      projectBounds(
        moonBounds,
        sky.moon.matrixWorld,
        camera,
        size.width,
        size.height,
      ),
    );
  }
  function render() {
    if (disposed || document.hidden || !sky) return;
    warmLight.intensity = 8 + (hovered ? 5 : 0) + transition * 65;
    backGlow.intensity = 5 + transition * 20;
    chest.glowMaterial.opacity = Math.min(
      1,
      0.85 + (hovered ? 0.12 : 0) + transition,
    );
    renderer.toneMappingExposure = 1.05 + transition * 2;
    terrain.update(time, reduced);
    sky.update(time, reduced);
    renderer.render(scene, camera);
    host.dataset.frames = String(++frameCount);
    // 资源统计仅在构图或画质变化时记录，方便性能验收且不产生逐帧序列化开销。
    if (recordResources) {
      host.dataset.resources = JSON.stringify({
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        shadowSize: moonLight.shadow.mapSize.x,
      });
      recordResources = false;
    }
  }
  function animate(timestamp: number) {
    if (disposed || document.hidden) return;
    time += Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    if (currentPointer.distanceToSquared(pointer) > 0.000001) {
      currentPointer.lerp(pointer, 0.04);
      camera.position.copy(baseCamera);
      camera.position.x += currentPointer.x * 0.1;
      camera.position.y += currentPointer.y * 0.06;
      syncTargets();
    }
    render();
  }
  function resize() {
    if (disposed) return;
    size = fitCamera(camera, renderer, host);
    baseCamera.copy(camera.position);
    currentPointer.set(0, 0);
    pointer.set(0, 0);
    terrain.setQuality(size.mobile);
    sky.resize(camera, size.preset, size.mobile);
    const shadowSize =
      sceneConfig.quality[size.mobile ? "mobile" : "desktop"].shadowSize;
    if (moonLight.shadow.mapSize.x !== shadowSize) {
      moonLight.shadow.map?.dispose();
      moonLight.shadow.map = null;
      moonLight.shadow.mapSize.setScalar(shadowSize);
    }
    renderer.shadowMap.needsUpdate = true;
    recordResources = true;
    host.dataset.quality = size.mobile ? "mobile" : "desktop";
    host.dataset.layout = size.name;
    syncTargets();
    render();
  }
  try {
    terrain = createTerrain();
    scene.add(terrain.group);
    sky = createSky(lunarMap);
    scene.add(sky.group);
    chest = createChest();
    scene.add(chest.box);
    scene.add(
      new THREE.HemisphereLight(0x9ebde8, 0x292719, 1.1),
      moonLight,
      warmLight,
      backGlow,
    );
    host.appendChild(renderer.domElement);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", updateLoop);
    renderer.debug.onShaderError = () => {
      throw new Error("月光场景着色器编译失败");
    };
    resize();
    updateLoop();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    // 正常模式由唯一渲染循环提交，避免过渡回调与动画回调在同一帧重复绘制。
    setHover(value) {
      hovered = value;
      if (reduced) render();
    },
    setTransition(value) {
      transition = value;
      if (reduced) render();
    },
    setReducedMotion(value) {
      reduced = value;
      resize();
      updateLoop();
    },
    setPointer(x, y) {
      if (!reduced) pointer.set(x, y);
    },
    resize,
    dispose,
  };
}
