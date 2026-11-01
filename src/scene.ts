import * as THREE from "three";
import { Initialization } from "./scene/initialization";
import { initializeTextures, warmScene } from "./scene/gpu-initialization";
import { ownTree } from "./scene/resources";
import { fitCamera, projectBounds, keepBoundsInView, openingCameraPosition, fitChoiceCamera } from "./responsive";
import { sceneConfig, pageConfig } from "./config";
import { transitionFrame } from "./transition";
import { choiceFrame, choiceGroundOffset, PROMPT_DURATION } from "./choice-prompt";
import { VisibleTime } from "./inscription-timeline";
import { createChest } from "./scene/chest";
import { chestPlacement, selectChestPlacement } from "./scene/chest-placement";
import { chestMotionBounds, chestPose } from "./scene/chest-motion";
import { createTerrain } from "./scene/terrain";
import { createSky } from "./scene/sky";
import { createMoonLight, syncMoonLight, fitMoonShadow, preserveLandscapeLight } from "./scene/moonlight";

export interface MoonScene {
  promptChoice(): void;
  cancelChoicePrompt(): void;
  setHover(value: boolean): void;
  setTransition(value: number): void;
  getLightScreenPosition(): { x: number; y: number };
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
  onProgress: (phase: string) => void = () => {},
): Promise<MoonScene> {
  // 超时守卫与离页共用取消信号，下载或生成中的迟到任务都不能恢复场景。
  const init = new Initialization(undefined, undefined, onProgress);
  const cancelInitialization = () => init.dispose();
  window.addEventListener("moon-boot-failed", cancelInitialization);
  window.addEventListener("pagehide", cancelInitialization);
  init.cleanup(() => {
    window.removeEventListener("moon-boot-failed", cancelInitialization);
    window.removeEventListener("pagehide", cancelInitialization);
  });
  try {
  // 月面解码完成后才创建和展示场景，避免白色占位球切换真实纹理造成第二次闪动。
  // 影像署名：NASA's Scientific Visualization Studio；LRO / LROC 月面颜色图。
  // 原始素材及使用信息：https://svs.gsfc.nasa.gov/4720/
  onProgress("moon-texture");
  const downloadStart = performance.now();
  const lunarMap = await init.wait(new THREE.TextureLoader().loadAsync(
    "/assets/moon-lroc.jpg",
  ));
  // 下载阶段包含图片解码；与后续生成和 GPU 上传分开，避免只看到一个笼统的等待时长。
  performance.measure("moon-texture-download", { start: downloadStart, end: performance.now() });
  lunarMap.colorSpace = THREE.SRGBColorSpace;
  lunarMap.anisotropy = 4;
  const contextStart = performance.now();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  performance.measure("moon-webgl-context", { start: contextStart, end: performance.now() });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // 待机与扩散阶段按需更新阴影；盒盖运动时逐帧请求新的实体阴影。
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  ownTree(init, scene);
  // 蓝灰距离雾把远山与地平线连在一起，近景仍保留墨绿和灰黑木色。
  scene.fog = new THREE.FogExp2(0x304f79, 0.0105);
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
  const baseCamera = new THREE.Vector3(), openCamera = new THREE.Vector3();
  const choiceCamera = new THREE.Vector3();
  let choiceFraming = 0;
  let choiceLightActive = false;
  let lidProgress = 0;
  // 提示时钟只累计前台可见时间，角度始终叠加在固定基准姿态上，避免累计漂移。
  let promptClock: VisibleTime | null = null;
  // 一次提示内只要启用过减少动态，余下时间始终保持静态，切回偏好不会重播。
  let promptStatic = false;
  let baseYaw = Math.PI;
  // 预先计算待机近景与完整展开两个端点；播放中只插值，不触发边缘阈值修正。
  const motion = chestMotionBounds();
  const motionBounds = new THREE.Box3(
    new THREE.Vector3(motion.minX, motion.minY, motion.minZ),
    new THREE.Vector3(motion.maxX, motion.maxY, motion.maxZ),
  ).expandByScalar(0.03);

  // 释放实例缓冲、共享纹理、阴影贴图和 WebGL 上下文；异常初始化也走同一路径。
  function dispose() {
    if (disposed) return;
    disposed = true;
    promptClock = null;
    renderer.setAnimationLoop(null);
    document.removeEventListener("visibilitychange", onVisibility);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    init.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  init.cleanup(dispose);
  /** 运行期故障只通知一次；先关闭循环和资源域，避免降级回调重入或异步画质任务恢复绘制。 */
  function fail(error: unknown) {
    if (disposed) return;
    try { dispose(); }
    finally { onFailure(error); }
  }
  /** 仅包围场景交付后的入口；初始化仍直接抛错，由调用方原有启动守卫接管。 */
  function run(action: () => void | Promise<void>) {
    if (disposed) return;
    try { action()?.catch(fail); }
    catch (error) { fail(error); }
  }
  function contextLost(event: Event) {
    event.preventDefault();
    fail(new Error("WebGL context lost"));
  }
  function updateLoop(draw = true) {
    if (disposed) return;
    lastTime = performance.now();
    if (document.hidden) promptClock?.pause();
    else promptClock?.sample(lastTime);
    renderer.setAnimationLoop(!reduced && !document.hidden ? onAnimation : null);
    if (draw) render();
  }
  function onVisibility() { run(() => updateLoop()); }
  function onAnimation(timestamp: number) { run(() => animate(timestamp)); }
  let chest: Awaited<ReturnType<typeof createChest>>,
    terrain: Awaited<ReturnType<typeof createTerrain>>,
    sky: Awaited<ReturnType<typeof createSky>>;
  let size: ReturnType<typeof fitCamera>;
  let syncLandscapeLight: ReturnType<typeof preserveLandscapeLight>;
  const moonBounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  // 柔和冷色补光显出灰黑木纹；盒内淡黄光仅在激活后随开盖显现。
  const warmLight = new THREE.PointLight(0xcbd6dd, 2, 7, 2);
  // 近景前移后补光维持原有相对距离，避免木纹和金色铰链因离开补光范围而失去层次。
  warmLight.position.set(chestPlacement.x - 1.35, 2.3, chestPlacement.z - 0.25);
  const lightPoint = new THREE.Vector3();
  function getLightScreenPosition() {
    camera.updateMatrixWorld();
    chest.lightAnchor.getWorldPosition(lightPoint).project(camera);
    return { x: (lightPoint.x + 1) * size.width / 2, y: (1 - lightPoint.y) * size.height / 2 };
  }
  const moonLight = createMoonLight();
  // 主光对准实际宝盒中心；月球随响应式构图移动时，受光面与背月投影使用同一个方向。
  const moonTarget = new THREE.Vector3(chestPlacement.x, 0.3, chestPlacement.z);
  const sceneShadowBounds = new THREE.Box3();
  let shadowVolumeReady = false;
  function syncLighting() {
    const directionChanged = syncMoonLight(moonLight, sky.moon, moonTarget);
    // 月球位置随构图改变时重新拟合整片植被，解决旧固定范围漏掉宽屏左侧草簇的问题。
    if (directionChanged || !shadowVolumeReady) {
      fitMoonShadow(moonLight, sceneShadowBounds);
      shadowVolumeReady = true;
      renderer.shadowMap.needsUpdate = true;
      recordResources = true;
    }
    syncLandscapeLight(camera, selectChestPlacement(size.mobile));
  }

  function syncTargets() {
    // 点击初始帧沿用近景，随着开盖平滑退让；触屏没有额外鼠标视差。
    openingCameraPosition(baseCamera, openCamera, reduced ? 0 : lidProgress, camera.position);
    // 正常尺寸端点与基准完全相同；只有已确认的短小屏会使用最小幅度的提示退让。
    if (choiceFraming > 0) camera.position.lerp(choiceCamera, choiceFraming);
    // 短屏退让只为宝盒腾出空间；天空同步相机位移，月球与月云继续保持原来的屏幕构图。
    sky.group.position.copy(choiceCamera).sub(baseCamera).multiplyScalar(choiceFraming);
    if (!reduced) {
      camera.position.x += currentPointer.x * 0.1;
      camera.position.y += currentPointer.y * 0.06;
    }
    chest.box.updateMatrixWorld();
    camera.updateMatrixWorld();
    sky.group.updateMatrixWorld(true);
    const b = projectBounds(
      chest.bounds,
      chest.box.matrixWorld,
      camera,
      size.width,
      size.height,
    );
    // 验收读取完整模型投影，而非已裁到视口内的按钮，避免把模型裁切误判为可见。
    host.dataset.boxBounds = JSON.stringify(b);
    // 验收记录真实世界坐标和实体比例，区分位置后移与模型缩小。
    host.dataset.chestPlacement = JSON.stringify({ position: chest.box.position.toArray(), scale: chest.box.scale.toArray() });
    // 同时记录真实端点的投影、高度与纵深，确保右端真正上抬，而非朝镜头水平旋开。
    const projectChestPoint = (point: THREE.Vector3) => {
      point.project(camera);
      return { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2 };
    };
    const hingePoint = chest.openingPivot.getWorldPosition(new THREE.Vector3());
    const tipPoint = chest.movingHalf.localToWorld(new THREE.Vector3(-1.85, 0.22, 0.3));
    host.dataset.chestPath = JSON.stringify({
      hingeWorldZ: hingePoint.z,
      tipWorldZ: tipPoint.z,
      hingeWorldY: hingePoint.y,
      tipWorldY: tipPoint.y,
      hinge: projectChestPoint(hingePoint),
      tip: projectChestPoint(tipPoint),
    });
    const left = Math.max(0, b.left - 10),
      top = Math.max(0, b.top - 10);
    // 页面不再显示盒底提示，点击区只需覆盖模型与必要的触控留白。
    Object.assign(hitTarget.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.max(44, Math.min(size.width, b.right + 10) - left)}px`,
      height: `${Math.max(44, Math.min(size.height, b.bottom + 10) - top)}px`,
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
  function render(force = false) {
    if (disposed || (document.hidden && !force) || !sky) return;
    const duration = reduced ? pageConfig.transition.reducedFade
      : pageConfig.transition.charge + pageConfig.transition.fade;
    const frame = transitionFrame(transition * duration, reduced, pageConfig.transition);
    lidProgress = frame.lid;
    const promptElapsed = promptClock?.sample(performance.now()) ?? PROMPT_DURATION;
    if (promptElapsed >= PROMPT_DURATION) promptClock = null;
    const hint = choiceFrame(promptElapsed, reduced || promptStatic);
    if (choiceLightActive !== (hint.light > 0)) {
      choiceLightActive = hint.light > 0;
      recordResources = true;
    }
    const framingChanged = choiceFraming !== hint.framing;
    choiceFraming = hint.framing;
    const yaw = baseYaw + hint.yaw;
    const groundedY = (choiceGroundOffset(hint.pitch, yaw, hint.roll) + hint.lift) * chest.box.scale.y;
    const poseChanged = chest.box.rotation.y !== yaw || chest.box.rotation.x !== hint.pitch ||
      chest.box.rotation.z !== hint.roll || chest.box.position.y !== groundedY;
    chest.box.rotation.set(hint.pitch, yaw, hint.roll);
    chest.box.position.y = groundedY;
    const lidChanged = chest.update(frame.lid, frame.glow, reduced, time, promptClock ? hint : undefined);
    if (lidChanged || poseChanged || framingChanged) {
      renderer.shadowMap.needsUpdate = true;
      syncTargets();
    }
    // 验收读数只记录真实盒体姿态，不暴露可写场景接口。
    host.dataset.choiceYaw = String(chest.box.rotation.y - baseYaw);
    // 只读采样与实际姿态共帧提交，便于验证接地、光效隔离和偏好切换后的精确归位。
    host.dataset.choicePose = JSON.stringify({ ...hint, groundedY,
      rotation: chest.box.rotation.toArray().slice(0, 3), exposure: 1.05 + frame.glow * .35,
      camera: camera.position.toArray() });
    // 补光只保留暗面木纹，方向性明暗由月光主导；激活后的暖光仍由盒内光源负责。
    warmLight.intensity = 2 + (hovered ? 0.2 : 0) + frame.glow;
    renderer.toneMappingExposure = 1.05 + frame.glow * 0.35;
    // 只读验收数据对应真实转轴与阴影行为，光圈从同一盒内锚点读取中心。
    host.dataset.lidAngle = String(-chest.openingPivot.rotation.z * 180 / Math.PI);
    // 验收同时检查水平转轴、变化的抬升高度与固定纵深，不能仅凭角度数字判断方向。
    host.dataset.openingRotation = JSON.stringify(chest.openingPivot.rotation.toArray().slice(0, 3));
    host.dataset.chestHeight = JSON.stringify([chest.bounds.min.y, chest.bounds.max.y]);
    host.dataset.lightSource = JSON.stringify(getLightScreenPosition());
    host.dataset.shadowMoving = String((frame.lid > 0 && frame.lid < 1) || (promptClock && !promptStatic && !reduced));
    host.dataset.beamsVisible = String(!reduced && frame.glow > 0);
    // 草簇投影按风场节奏刷新；静止、减少动态与后台状态仍沿用按需渲染。
    if (terrain.update(time, reduced)) renderer.shadowMap.needsUpdate = true;
    sky.update(time, reduced);
    syncLighting();
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
      // 验收读取真实月球、灯位与目标，验证缩放屏幕后光向和阴影确实改变。
      host.dataset.moonLighting = JSON.stringify({
        moon: sky.moon.getWorldPosition(new THREE.Vector3()).toArray(),
        light: moonLight.position.toArray(), target: moonLight.target.position.toArray(),
        direction: moonLight.position.clone().sub(moonLight.target.position).normalize().toArray(),
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
      syncTargets();
    }
    render();
  }
  function resize(draw = true) {
    if (disposed) return;
    const layoutStart = performance.now();
    size = fitCamera(camera, renderer, host);
    if (!draw) performance.measure("moon-layout-camera", { start: layoutStart, end: performance.now() });
    // 取景只依据基准闭合姿态，尺寸变化不能把瞬时颤动写入相机端点。
    chest.box.rotation.set(0, baseYaw, 0);
    // 只让 PC 模式移动盒体；手机位置、模型比例及取景预设继续沿用已确认的参数。
    const placement = selectChestPlacement(size.mobile);
    chest.box.position.set(placement.x, 0, placement.z);
    warmLight.position.set(placement.x - 1.35, 2.3, placement.z - 0.25);
    moonTarget.set(placement.x, 0.3, placement.z);
    chest.box.updateMatrixWorld();
    sceneShadowBounds.copy(motionBounds).applyMatrix4(chest.box.matrixWorld)
      .union(terrain.shadowBounds).expandByScalar(0.1);
    shadowVolumeReady = false;
    const presetCamera = camera.position.clone();
    keepBoundsInView(motionBounds, chest.box.matrixWorld, camera, size.width, size.height);
    openCamera.copy(camera.position);
    // 待机只适配闭合盒体，让前移真正产生近景，而非一开始就退到展开距离。
    const closed = chestPose(0).bounds;
    const closedBounds = new THREE.Box3(
      new THREE.Vector3(closed.minX, closed.minY, closed.minZ),
      new THREE.Vector3(closed.maxX, closed.maxY, closed.maxZ),
    ).expandByScalar(0.03);
    camera.position.copy(presetCamera);
    keepBoundsInView(closedBounds, chest.box.matrixWorld, camera, size.width, size.height);
    baseCamera.copy(camera.position);
    // 尺寸变化时读取入口边界，并为原有文字抖动和图标外沿保留固定余量。
    const entries = [...document.querySelectorAll<HTMLElement>("[data-entrance] .journey-copy")];
    const choicesRect = entries.map(entry => entry.getBoundingClientRect());
    if (choicesRect.length) {
      const peak = chestPose(26 / 180).bounds;
      const hintBounds = new THREE.Box3(new THREE.Vector3(peak.minX, peak.minY, peak.minZ),
        new THREE.Vector3(peak.maxX, peak.maxY, peak.maxZ)).expandByScalar(.16);
      fitChoiceCamera(hintBounds, chest.box.matrixWorld, camera, size.width, size.height, {
        left: Math.min(...choicesRect.map(r => r.left)) - 6,
        right: Math.max(...choicesRect.map(r => r.right)) + 6,
        bottom: Math.max(...choicesRect.map(r => r.bottom)) + 10,
      });
    }
    choiceCamera.copy(camera.position);
    camera.position.copy(baseCamera);
    // screenPoint 使用 matrixWorld 反投影；恢复坐标后同步矩阵，不能把提示端点误当成天空基准。
    camera.updateMatrixWorld();
    // render 按原可见时间重新采样并恢复当前姿态，不把瞬时倾斜或支撑高度纳入构图基准。
    currentPointer.set(0, 0);
    pointer.set(0, 0);
    // 画质切换也分批生成；完成后才提交新几何，取消后的续体不再渲染。
    // 矮屏和触控横屏继续采用轻量画质，但草的横向覆盖必须跟随实际相机构图。
    const quality = terrain.setQuality(size.mobile, size.width >= size.height || size.name !== "mobile").then(() => {
      if (!disposed && draw) { renderer.shadowMap.needsUpdate = true; recordResources = true; render(); }
    });
    // 同步布局若在返回 Promise 前抛错，画质任务也已有拒绝处理；初始化失败仍由 await 原样抛出。
    void quality.catch(error => { if (draw) fail(error); });
    sky.group.position.set(0, 0, 0);
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
    if (!draw) performance.measure("moon-layout", { start: layoutStart, end: performance.now() });
    if (draw) render();
    return quality;
  }
  try {
    // 在大量二维纹理绘制之前确定绘图缓冲尺寸，避免末尾重置 WebGL 画布同步等待积压的栅格工作。
    fitCamera(camera, renderer, host);
    // WebGL 上下文创建是浏览器同步操作，先让出任务，再开始记录可分批生成阶段。
    await init.checkpoint(true);
    performance.mark("moon-generation-start");
    terrain = await createTerrain(init);
    syncLandscapeLight = preserveLandscapeLight(terrain.group);
    scene.add(terrain.group);
    sky = await createSky(lunarMap, init);
    scene.add(sky.group);
    chest = await createChest(init);
    baseYaw = chest.box.rotation.y;
    performance.mark("moon-generation-end");
    performance.measure("moon-generation", "moon-generation-start", "moon-generation-end");
    scene.add(chest.box);
    // 阴影范围同时合并盒盖完整扫掠体积，不能只扩大左右草地而裁掉竖起的上盖。
    chest.box.updateMatrixWorld(true);
    sceneShadowBounds.copy(motionBounds).applyMatrix4(chest.box.matrixWorld)
      .union(terrain.shadowBounds).expandByScalar(0.1);
    scene.add(
      new THREE.HemisphereLight(0x9ebde8, 0x292719, 1.1),
      moonLight,
      moonLight.target,
      warmLight,
    );
    init.check();
    await init.checkpoint(true);
    host.appendChild(renderer.domElement);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.debug.onShaderError = () => {
      throw new Error("月光场景着色器编译失败");
    };
    // 初始化取景和画质只计算布局，不提前提交整场景；预热使用最终相机与实际阴影范围。
    await resize(false);
    init.check();
    terrain.update(time, reduced);
    sky.update(time, reduced);
    syncLighting();
    await initializeTextures(renderer, scene, init);
    // 三路提示首次播放也必须保留完整返回/冲击阶段；在加载门禁内编译所有提示材质与扫光组合。
    let compilePass = 0;
    await chest.prepareChoice(async () => {
      // GPU 编译属于独立的真实等待阶段，慢手机不能沿用下载阶段已经消耗的超时预算。
      onProgress(`gpu-compile-${++compilePass}`);
      init.phase = `gpu-choice-${compilePass}`;
      await warmScene(renderer, scene, camera, init);
      init.check();
    });
    // 开盖光效独立于宝盒提示，必须预热实际旅程使用的材质和灯光组合。
    await chest.prepareOpening(async () => {
      onProgress(`opening-compile-${++compilePass}`);
      init.phase = `gpu-opening-${compilePass}`;
      await warmScene(renderer, scene, camera, init);
      init.check();
    });
    onProgress("first-frame");
    init.phase = "first-frame";
    await init.checkpoint(true);
    const firstSubmit = performance.now();
    render(true);
    const firstSubmitMs = performance.now() - firstSubmit;
    performance.measure("moon-first-frame", { start: firstSubmit, end: performance.now() });
    // 正式首帧只提交一次；随后接上既有循环，后台变化仍沿用原来的暂停行为。
    // 首次 GPU 提交单独记录，不计入可分批的 CPU 生成耗时。
    host.dataset.initialization = JSON.stringify({ batches: init.batches,
      phases: init.phases,
      firstSubmitMs });
    await init.checkpoint(true);
    // 所有初始化等待结束后再交付事件和循环，确保异步回调不会逃过启动错误边界。
    document.addEventListener("visibilitychange", onVisibility);
    updateLoop(false);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    promptChoice() {
      if (disposed || promptClock) return;
      promptStatic = reduced;
      promptClock = new VisibleTime();
      promptClock.sample(performance.now());
      recordResources = true;
    },
    cancelChoicePrompt() {
      run(() => {
        promptClock = null;
        recordResources = true;
        // 无条件提交闭合基准和熄光；即使取消恰好落在偏航为零的一帧，也不能遗留开盖或光环。
        render();
      });
    },
    // 正常模式由唯一渲染循环提交，避免过渡回调与动画回调在同一帧重复绘制。
    setHover(value) {
      run(() => {
        hovered = value;
        if (reduced) render();
      });
    },
    setTransition(value) {
      run(() => {
        transition = value;
        if (reduced) render();
      });
    },
    getLightScreenPosition,
    setReducedMotion(value) {
      run(() => {
        if (value && promptClock) promptStatic = true;
        reduced = value;
        const quality = resize();
        updateLoop();
        return quality;
      });
    },
    setPointer(x, y) {
      if (!reduced) pointer.set(x, y);
    },
    resize() { run(() => resize()); },
    dispose,
  };
  } catch (error) { init.dispose(); throw error; }
}
