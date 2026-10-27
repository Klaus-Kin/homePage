import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Initialization } from "./initialization";
import { ownTree } from "./resources";
import { createPlane, computeNormals } from "./geometry";
import { sceneConfig } from "../config";
import { fbm, groundHeight, seededRandom } from "./terrain-math";
import { surfaceTexture } from "./textures";
import { createMountains } from "./mountains";
import { obstacleFootprint, overlapsFootprint, grassReach, chestFootprint, isForegroundRock } from "./terrain-clearance";

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
    bumpScale: 0.13,
    roughness: 1,
  }));
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
  for (let attempt = 0; rockCount < quality.rocks && attempt < quality.rocks * 8; attempt++) {
    const pause = init.checkpoint(); if (pause) await pause;
    let x = (random() - 0.5) * 33,
      z = random() * 20 - 8;
    if (Math.abs(x) < 2.2 && Math.abs(z) < 1.5) x += 3;
    // 镜头附近只保留低矮小石，保留原有数量但降低它们在画面中的体量。
    const nearScale = z > 3 ? 0.56 : 0.8;
    const size = (0.12 + Math.pow(random(), 3) * 0.95) * nearScale;
    dummy.position.set(x, groundHeight(x, z) - size * 0.18, z);
    dummy.scale.set(size * 1.35, size * 0.62, size);
    dummy.rotation.set(random() * 0.4, random() * 6, random() * 0.4);
    dummy.updateMatrix();
    // 使用变形后顶点和实例完整矩阵；先避开盒体及上盖落点，再用于草叶避让。
    const footprint = obstacleFootprint(rp.array, dummy.matrix.elements);
    const radius = Math.max(...footprint.map((p) => Math.hypot(p.x - x, p.z - z)));
    if (overlapsFootprint(x, z, radius, chestFootprint)) continue;
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
  const wind = { value: 0 },
    windStrength = { value: 1 };
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0xb3bc83,
    emissive: 0x182413,
    emissiveIntensity: 0.25,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  grassMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.uniforms.uWindStrength = windStrength;
    shader.vertexShader =
      "uniform float uWindTime; uniform float uWindStrength;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      transformed.x += sin(uWindTime * 1.4 + instanceMatrix[3].x * 0.8 + instanceMatrix[3].z) * position.y * position.y * 0.24 * uWindStrength;`,
    );
  };
  const grass = new THREE.InstancedMesh(blade, grassMaterial, quality.grass);
  group.add(grass);
  const color = new THREE.Color();
  let clusterX = 0,
    clusterZ = 0;
  let grassCount = 0;
  for (let i = 0; grassCount < quality.grass && i < quality.grass * 8; i++) {
    // 避让检查会遍历岩石轮廓，按尝试次数切批，包含未成功放置的草叶。
    if (i % 16 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    // 成簇散布，远处草叶自动缩小；盒体内不生成草，但边缘可自然遮挡脚部。
    if (i % 5 === 0) {
      clusterX = (random() - 0.5) * 24;
      clusterZ = random() * 18 - 5;
    }
    let x = clusterX + (random() - 0.5) * 0.35,
      z = clusterZ + (random() - 0.5) * 0.35;
    if (Math.abs(x) < 1.86 && Math.abs(z) < 0.86) {
      x += Math.sign(x || 1) * 2.0;
    }
    const density = fbm(x * 1.5 + 3, z * 1.5 + 8);
    const size =
      (0.25 + random() * 0.5) * (z < -3 ? 0.65 : 1) * (0.6 + density);
    const yaw = random() * Math.PI * 2, lean = (random() - 0.5) * 0.3;
    const reach = grassReach(size, lean);
    if (overlapsFootprint(x, z, reach, chestFootprint) ||
      rockFootprints.some((footprint) => overlapsFootprint(x, z, reach, footprint))) continue;
    dummy.position.set(x, groundHeight(x, z) - 0.015, z);
    dummy.rotation.set(0, yaw, lean);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    grass.setMatrixAt(grassCount, dummy.matrix);
    color.setHSL(
      0.18 + random() * 0.09,
      0.25 + random() * 0.3,
      0.32 + random() * 0.23,
    );
    grass.setColorAt(grassCount++, color);
  }
  grass.receiveShadow = true;
  group.add(grass);

  // 花朵以少量实例点缀；花色压低，避免抢占宝盒的暖光焦点。
  const flowers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.034, 5, 3),
    new THREE.MeshStandardMaterial({ color: 0xe7d9b4, roughness: 0.9 }),
    quality.flowers,
  );
  group.add(flowers);
  let flowerCount = 0;
  for (let i = 0; flowerCount < quality.flowers && i < quality.flowers * 8; i++) {
    const pause = init.checkpoint(); if (pause) await pause;
    let x = (random() - 0.5) * 17,
      z = random() * 12 - 3;
    if (Math.abs(x) < 2 && Math.abs(z) < 1) x += 2.3;
    // 花头同样避开石体和盒盖，避免修复草叶后留下穿石花朵。
    if (overlapsFootprint(x, z, 0.04, chestFootprint) ||
      rockFootprints.some((footprint) => overlapsFootprint(x, z, 0.04, footprint))) continue;
    dummy.position.set(x, groundHeight(x, z) + 0.12 + random() * 0.15, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 0.45, 1);
    dummy.updateMatrix();
    flowers.setMatrixAt(flowerCount, dummy.matrix);
    flowers.setColorAt(flowerCount++, color.set(i % 3 ? 0xd0c3a2 : 0xc9a74c));
  }
  group.add(flowers);
  // 达到尝试上限时不绘制未初始化实例；轻量模式仍沿用同一批通过避让的对象。
  grass.count = grassCount; rocks.count = rockCount; flowers.count = flowerCount;
  let qualityRevision = 0;
  return {
    group,
    update(time: number, reduced: boolean) {
      wind.value = time;
      windStrength.value = reduced ? 0 : 1;
    },
    async setQuality(mobile: boolean) {
      // 山体等待期间可能再次旋转屏幕，旧请求不能覆盖最新的植被数量。
      const request = ++qualityRevision;
      // 在第一个 await 前清除手机前景，避免第一帧先显示石头、山体切换后才消失。
      const preset = sceneConfig.quality[mobile ? "mobile" : "desktop"];
      rocks.count = Math.min(preset.rocks, mobile ? backgroundRocks.length : rockCount);
      await mountains.setQuality(mobile);
      if (request !== qualityRevision || init.controller.signal.aborted) return;
      grass.count = Math.min(preset.grass, grassCount);
      flowers.count = Math.min(preset.flowers, flowerCount);
    },
  };
}
