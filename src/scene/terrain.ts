import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Initialization } from "./initialization";
import { ownTree } from "./resources";
import { createPlane, computeNormals } from "./geometry";
import { sceneConfig } from "../config";
import { fbm, groundHeight, seededRandom } from "./terrain-math";
import { surfaceTexture } from "./textures";
import { createMountains } from "./mountains";
import { obstacleFootprint, overlapsChestScenery, isForegroundRock, isCenterMeadowRock } from "./terrain-clearance";
import { createMeadow } from "./meadow";
import { desktopChestPlacement } from "./chest-placement";
import { createRockSurface, createWeatheredRockGeometry } from "./rock-surface";
import { createRockContacts } from "./rock-contact";

/** 连续山坡、山谷和植被共享世界坐标；相机看到的是一整片地形。 */
export async function createTerrain(init: Initialization) {
  const group = ownTree(init, new THREE.Group());
  const random = seededRandom(842);
  const quality = sceneConfig.quality.desktop;
  const initialMobile = window.innerWidth < 768 || window.innerHeight < 500 || matchMedia("(pointer: coarse)").matches;
  // 山体计算先交给共享 Worker；主线程同时准备地面、木纹与岩石，减少原先串行等待。
  const mountainsReady = createMountains(init.fork());
  void mountainsReady.catch(() => {});
  const groundMap = await surfaceTexture("ground", init);
  const earth = init.track(new THREE.MeshStandardMaterial({
    map: groundMap,
    bumpMap: groundMap,
    // 凹凸仅保留细微起伏，避免把重复纹理渲染成割裂草坡的沟槽。
    bumpScale: 0.045,
    roughness: 1,
  }));
  earth.name = "meadow-ground";
  const stone = await createRockSurface(init);
  init.phase = "ground";
  const geometry = await createPlane(130, 130, 180, 180, init);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -40);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    if (i % 32 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    positions.setY(i, groundHeight(positions.getX(i), positions.getZ(i)));
  }
  await computeNormals(geometry, init);
  // 手机地面原样缓存；PC 单独准备后移位置的平缓支撑区，切换时不移动或缩放整个草坡。
  init.track(geometry);
  const desktopGround = init.track(geometry.clone());
  const desktopPositions = desktopGround.attributes.position;
  for (let i = 0; i < desktopPositions.count; i++) {
    if (i % 32 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    desktopPositions.setY(i, groundHeight(desktopPositions.getX(i), desktopPositions.getZ(i), desktopChestPlacement));
  }
  await computeNormals(desktopGround, init);
  const ground = new THREE.Mesh(geometry, earth);
  ground.name = "terrain-ground";
  ground.receiveShadow = true;
  group.add(ground);

  // 数层真正的起伏山脊位于不同距离，距离雾统一衰减，不使用背景照片。
  const mountains = await mountainsReady;
  group.add(mountains.group);
  init.phase = "vegetation";

  // 岩石采用实例化多面体，各实例非等比缩放并埋入地表，减少重复轮廓。
  // 低频风化起伏代替细碎尖角，焊接顶点后重算法线，使受光沿圆缓石面连续过渡。
  const rockSource = new THREE.IcosahedronGeometry(1, 2);
  const sourcePositions = rockSource.attributes.position;
  for (let i = 0; i < sourcePositions.count; i++) {
    const x = sourcePositions.getX(i), y = sourcePositions.getY(i), z = sourcePositions.getZ(i);
    const k = 0.9 + fbm(x * 1.4 + 6, z * 1.4 + y * 0.6 + 8) * 0.18;
    sourcePositions.setXYZ(i, x * k, y * k, z * k);
  }
  rockSource.deleteAttribute("normal");
  const placementGeometry = init.track(mergeVertices(rockSource));
  rockSource.dispose();
  // 旧几何仅作为布局包络，避免新轮廓改变筛选结果，导致后续石头和草丛重新洗牌。
  const rp = placementGeometry.attributes.position;
  const rockGeometry = init.track(await createWeatheredRockGeometry(placementGeometry, init));
  const rocks = new THREE.InstancedMesh(rockGeometry, stone.material, quality.rocks);
  rocks.customDepthMaterial = stone.depth;
  group.add(rocks);
  const dummy = new THREE.Object3D();
  const rockFootprints: ReturnType<typeof obstacleFootprint>[] = [];
  // 背景实例放在前段，手机画质直接截断前景段；旋转屏幕无需销毁或重新生成石头。
  const backgroundRocks: THREE.Matrix4[] = [], foregroundRocks: THREE.Matrix4[] = [];
  let rockCount = 0;
  let candidateRockCount = 0;
  for (let attempt = 0; candidateRockCount < quality.rocks && attempt < quality.rocks * 8; attempt++) {
    const pause = init.checkpoint(); if (pause) await pause;
    let x = (random() - 0.5) * 33,
      z = random() * 20 - 8;
    if (Math.abs(x) < 2.2 && Math.abs(z) < 1.5) x += 3;
    // 镜头附近只保留低矮小石，降低它们在画面中的体量。
    const nearScale = z > 3 ? 0.56 : 0.8;
    const size = (0.12 + Math.pow(random(), 3) * 0.95) * nearScale;
    dummy.position.set(x, groundHeight(x, z) - size * 0.18, z);
    dummy.scale.set(size * 1.35, size * 0.62, size);
    dummy.rotation.set(random() * 0.4, random() * 6, random() * 0.4);
    dummy.updateMatrix();
    // 使用变形后顶点和实例完整矩阵；先避开盒体及上盖落点，再用于草叶避让。
    const footprint = obstacleFootprint(rp.array, dummy.matrix.elements);
    const radius = Math.max(...footprint.map((p) => Math.hypot(p.x - x, p.z - z)));
    if (overlapsChestScenery(x, z, radius)) continue;
    // 三块中央石头不补位，随机序列也保持不变，左右和背景石头不会因此重新洗牌。
    candidateRockCount++;
    if (isCenterMeadowRock(x, z)) continue;
    (isForegroundRock(footprint) ? foregroundRocks : backgroundRocks).push(dummy.matrix.clone());
    rockCount++;
    rockFootprints.push(footprint);
  }
  [...backgroundRocks, ...foregroundRocks].forEach((matrix, index) => rocks.setMatrixAt(index, matrix));
  rocks.name = "terrain-rocks";
  rocks.userData.backgroundCount = backgroundRocks.length;
  rocks.castShadow = rocks.receiveShadow = true;
  group.add(rocks);

  // 草甸使用独立随机种子，不消耗岩石序列；各层均参与取消、贴地、避让和阴影范围。
  const meadow = await createMeadow(init, geometry, desktopGround, rockFootprints, initialMobile);
  group.add(meadow.group);
  rocks.count = rockCount;
  const phoneRocks = rocks.instanceMatrix.array.slice();
  const pcRocks = new Float32Array(phoneRocks.length);
  let pcRockCount = 0;
  const instanceMatrix = new THREE.Matrix4(), instancePosition = new THREE.Vector3(),
    instanceScale = new THREE.Vector3(), instanceRotation = new THREE.Quaternion();
  for (let i = 0; i < rockCount; i++) {
    const pause = init.checkpoint(); if (pause) await pause;
    instanceMatrix.fromArray(phoneRocks, i * 16).decompose(instancePosition, instanceRotation, instanceScale);
    const footprint = obstacleFootprint(rp.array, instanceMatrix.elements);
    const radius = Math.max(...footprint.map(p => Math.hypot(p.x - instancePosition.x, p.z - instancePosition.z)));
    if (overlapsChestScenery(instancePosition.x, instancePosition.z, radius, desktopChestPlacement)) continue;
    pcRocks.set(phoneRocks.subarray(i * 16, i * 16 + 16), pcRockCount * 16);
    pcRocks[pcRockCount * 16 + 13] += groundHeight(instancePosition.x, instancePosition.z, desktopChestPlacement)
      - groundHeight(instancePosition.x, instancePosition.z);
    pcRockCount++;
  }
  // 石边草使用独立缓存与种子，既有岩石和草甸矩阵不变；根部采样各构图实际绘制的地面。
  const rockContacts = await createRockContacts(init, rockGeometry, [
    { matrices: pcRocks, count: pcRockCount, ground: desktopGround },
    { matrices: phoneRocks, count: Math.min(sceneConfig.quality.mobile.rocks, backgroundRocks.length), ground: geometry },
  ], initialMobile);
  group.add(rockContacts.mesh);
  earth.userData.rockContacts = { mask: rockContacts.shadowMask, bounds: { value: rockContacts.maskBounds } };
  // 在首次画质截断前计算全部实例的包围盒；超宽屏、手机旋转和完整开盖共用稳定覆盖范围。
  rocks.computeBoundingBox();
  const shadowBounds = meadow.shadowBounds.clone().union(rocks.boundingBox!).union(rockContacts.shadowBounds).expandByScalar(.8);
  let qualityRevision = 0, lastMobile: boolean | undefined;
  return {
    group,
    shadowBounds,
    setDetail(level: number) { meadow.setDetail(level); },
    update(time: number, reduced: boolean) {
      // 两层共享主渲染循环与阴影刷新节奏，不能用短路表达式漏掉第二层风场更新。
      const meadowChanged = meadow.update(time, reduced);
      return rockContacts.update(time, reduced) || meadowChanged;
    },
    async setQuality(mobile: boolean, wideMeadow = !mobile) {
      // 山体等待期间可能再次旋转屏幕，旧请求不能覆盖最新的植被数量。
      const request = ++qualityRevision;
      // 在第一个 await 前清除手机前景，避免第一帧先显示石头、山体切换后才消失。
      const preset = sceneConfig.quality[mobile ? "mobile" : "desktop"];
      // 同属轻量画质的手机横竖屏也要更新草的覆盖，不能只由画质是否改变来判断。
      await Promise.all([meadow.setQuality(mobile, wideMeadow), rockContacts.setQuality(mobile), mountains.setQuality(mobile)]);
      if (request !== qualityRevision || init.controller.signal.aborted) return;
      shadowBounds.union(meadow.shadowBounds).union(rockContacts.shadowBounds);
      if (lastMobile !== mobile) {
        ground.geometry = mobile ? geometry : desktopGround;
        rocks.instanceMatrix.array.set(mobile ? phoneRocks : pcRocks);
        rocks.instanceMatrix.needsUpdate = true;
        rocks.count = mobile ? rockCount : pcRockCount;
        rocks.computeBoundingBox(); rocks.computeBoundingSphere();
        lastMobile = mobile;
      }
      rocks.count = Math.min(preset.rocks, mobile ? backgroundRocks.length : pcRockCount);
    },
  };
}
