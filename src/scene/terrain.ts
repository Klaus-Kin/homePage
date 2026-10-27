import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Initialization } from "./initialization";
import { ownTree } from "./resources";
import { createPlane, computeNormals } from "./geometry";
import { sceneConfig } from "../config";
import { fbm, groundHeight, seededRandom } from "./terrain-math";
import { surfaceTexture } from "./textures";
import { createMountains } from "./mountains";
import { obstacleFootprint, overlapsFootprint, grassReach, overlapsChestScenery, isForegroundRock, isCenterMeadowRock } from "./terrain-clearance";
import { sampleGrassTuft, grassCountForBudget } from "./grass-distribution";
import { createGrassMaterials } from "./grass-material";

/** 连续山坡、山谷和植被共享世界坐标；相机看到的是一整片地形。 */
export async function createTerrain(init: Initialization) {
  const group = ownTree(init, new THREE.Group());
  const random = seededRandom(842);
  const quality = sceneConfig.quality.desktop;
  const groundMap = await surfaceTexture("ground", init),
    rockMap = await surfaceTexture("rock", init);
  const earth = init.track(new THREE.MeshStandardMaterial({
    map: groundMap,
    bumpMap: groundMap,
    // 凹凸仅保留细微起伏，避免把重复纹理渲染成割裂草坡的沟槽。
    bumpScale: 0.045,
    roughness: 1,
  }));
  earth.name = "meadow-ground";
  const stone = init.track(new THREE.MeshStandardMaterial({
    map: rockMap,
    bumpMap: rockMap,
    bumpScale: 0.035,
    roughness: 0.96,
  }));
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
  const ground = new THREE.Mesh(geometry, earth);
  ground.name = "terrain-ground";
  ground.receiveShadow = true;
  group.add(ground);

  // 数层真正的起伏山脊位于不同距离，距离雾统一衰减，不使用背景照片。
  const mountains = await createMountains(init);
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
  const rockGeometry = mergeVertices(rockSource);
  rockSource.dispose();
  const rp = rockGeometry.attributes.position;
  rockGeometry.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeometry, stone, quality.rocks);
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

  // 每片草只有三个三角形；顶点摆动在 GPU 内完成，CPU 不逐帧更新实例矩阵。
  const blade = new THREE.BufferGeometry();
  blade.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.035, 0, 0, 0.035, 0, 0, -0.018, 0.28, 0.025, 0.018, 0.28, 0.025,
        0.03, 0.54, 0.08,
      ],
      3,
    ),
  );
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  blade.computeVertexNormals();
  const grassMaterials = createGrassMaterials();
  const grass = new THREE.InstancedMesh(blade, grassMaterials.material, quality.grass);
  // 深度通道复用风动变形，且独立登记释放；打开投影后草簇才会在地面留下真实阴影。
  grass.customDepthMaterial = init.track(grassMaterials.depth);
  group.add(grass);
  const color = new THREE.Color();
  const tuftEnds: number[] = [];
  const tuftCenters: { x: number; z: number }[] = [];
  let grassCount = 0;
  for (let i = 0; grassCount < quality.grass && i < quality.grass * 8; i++) {
    // 避让检查会遍历岩石轮廓，按尝试次数切批，包含未成功放置的草叶。
    if (i % 16 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    // 成簇散布，远处草叶自动缩小；盒体内不生成草，但边缘可自然遮挡脚部。
    const tuft = sampleGrassTuft(random);
    if (!tuft) continue;
    // 簇间保留距离，防止多个紧凑根部重叠后又连成均匀草海。
    if (tuftCenters.some(center => Math.hypot(center.x - tuft.x, center.z - tuft.z) < 0.4)) continue;
    if (grassCount + tuft.blades.length > quality.grass) break;
    // 按整簇检查每片草的完整摆动包络；靠近石头或盒盖时整簇跳过，避免剩下零散几片。
    if (tuft.blades.some(({ x, z, size, lean }) => {
      const reach = grassReach(size, lean);
      return overlapsChestScenery(x, z, reach) ||
        rockFootprints.some(footprint => overlapsFootprint(x, z, reach, footprint));
    })) continue;
    for (const { x, z, size, yaw, lean } of tuft.blades) {
      dummy.position.set(x, groundHeight(x, z) - 0.015, z);
      dummy.rotation.set(0, yaw, lean);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      grass.setMatrixAt(grassCount, dummy.matrix);
      // 簇内轻微明暗差保留层次，色相统一，避免黄绿叶片交错产生杂乱感。
      color.setHSL(tuft.hue, 0.42, tuft.lightness + random() * 0.035);
      grass.setColorAt(grassCount++, color);
    }
    tuftEnds.push(grassCount);
    tuftCenters.push({ x: tuft.x, z: tuft.z });
  }
  grass.name = "terrain-grass";
  grass.castShadow = grass.receiveShadow = true;
  group.add(grass);

  // 达到尝试上限时不绘制未初始化实例；轻量模式仍沿用同一批通过避让的对象。
  grass.count = grassCount; rocks.count = rockCount;
  // 在首次画质截断前计算全部实例的包围盒；超宽屏、手机旋转和完整开盖共用稳定覆盖范围。
  grass.computeBoundingBox(); rocks.computeBoundingBox();
  const shadowBounds = grass.boundingBox!.clone().union(rocks.boundingBox!).expandByScalar(0.8);
  let qualityRevision = 0;
  return {
    group,
    shadowBounds,
    update(time: number, reduced: boolean) {
      return grassMaterials.update(time, reduced);
    },
    async setQuality(mobile: boolean) {
      // 山体等待期间可能再次旋转屏幕，旧请求不能覆盖最新的植被数量。
      const request = ++qualityRevision;
      // 在第一个 await 前清除手机前景，避免第一帧先显示石头、山体切换后才消失。
      const preset = sceneConfig.quality[mobile ? "mobile" : "desktop"];
      rocks.count = Math.min(preset.rocks, mobile ? backgroundRocks.length : rockCount);
      await mountains.setQuality(mobile);
      if (request !== qualityRevision || init.controller.signal.aborted) return;
      grass.count = grassCountForBudget(tuftEnds, preset.grass);
    },
  };
}
