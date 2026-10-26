import * as THREE from "three";
import { sceneConfig } from "../config";
import { fbm, groundHeight, seededRandom } from "./terrain-math";
import { surfaceTexture } from "./textures";
import { createMountains } from "./mountains";

/** 连续山坡、山谷和植被共享世界坐标；相机看到的是一整片地形。 */
export function createTerrain() {
  const group = new THREE.Group();
  const random = seededRandom(842);
  const quality = sceneConfig.quality.desktop;
  const groundMap = surfaceTexture("ground"),
    rockMap = surfaceTexture("rock");
  const earth = new THREE.MeshStandardMaterial({
    map: groundMap,
    bumpMap: groundMap,
    bumpScale: 0.13,
    roughness: 1,
  });
  const stone = new THREE.MeshStandardMaterial({
    map: rockMap,
    bumpMap: rockMap,
    bumpScale: 0.17,
    roughness: 0.96,
  });
  const geometry = new THREE.PlaneGeometry(130, 130, 180, 180);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -40);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++)
    positions.setY(i, groundHeight(positions.getX(i), positions.getZ(i)));
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, earth);
  ground.receiveShadow = true;
  group.add(ground);

  // 数层真正的起伏山脊位于不同距离，距离雾统一衰减，不使用背景照片。
  const mountains = createMountains();
  group.add(mountains.group);

  // 岩石采用实例化多面体，各实例非等比缩放并埋入地表，减少重复轮廓。
  const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rp = rockGeometry.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const k = 0.82 + fbm(rp.getX(i) * 4 + 6, rp.getZ(i) * 4 + 8) * 0.35;
    rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k, rp.getZ(i) * k);
  }
  rockGeometry.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeometry, stone, quality.rocks);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < quality.rocks; i++) {
    let x = (random() - 0.5) * 33,
      z = random() * 20 - 8;
    if (Math.abs(x) < 2.2 && Math.abs(z) < 1.5) x += 3;
    const size = 0.12 + Math.pow(random(), 3) * 1.25;
    dummy.position.set(x, groundHeight(x, z) - 0.08, z);
    dummy.scale.set(size * 1.5, size * 0.7, size);
    dummy.rotation.set(random() * 0.4, random() * 6, random() * 0.4);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
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
  const color = new THREE.Color();
  let clusterX = 0,
    clusterZ = 0;
  for (let i = 0; i < quality.grass; i++) {
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
    dummy.position.set(x, groundHeight(x, z) - 0.015, z);
    dummy.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.3);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    color.setHSL(
      0.18 + random() * 0.09,
      0.25 + random() * 0.3,
      0.32 + random() * 0.23,
    );
    grass.setColorAt(i, color);
  }
  grass.receiveShadow = true;
  group.add(grass);

  // 花朵以少量实例点缀；花色压低，避免抢占宝盒的暖光焦点。
  const flowers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.034, 5, 3),
    new THREE.MeshStandardMaterial({ color: 0xe7d9b4, roughness: 0.9 }),
    quality.flowers,
  );
  for (let i = 0; i < quality.flowers; i++) {
    let x = (random() - 0.5) * 17,
      z = random() * 12 - 3;
    if (Math.abs(x) < 2 && Math.abs(z) < 1) x += 2.3;
    dummy.position.set(x, groundHeight(x, z) + 0.12 + random() * 0.15, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 0.45, 1);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, color.set(i % 3 ? 0xd0c3a2 : 0xc9a74c));
  }
  group.add(flowers);
  return {
    group,
    update(time: number, reduced: boolean) {
      wind.value = time;
      windStrength.value = reduced ? 0 : 1;
    },
    setQuality(mobile: boolean) {
      mountains.setQuality(mobile);
      const preset = sceneConfig.quality[mobile ? "mobile" : "desktop"];
      grass.count = preset.grass;
      rocks.count = preset.rocks;
      flowers.count = preset.flowers;
    },
  };
}
