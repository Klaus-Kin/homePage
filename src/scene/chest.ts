import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { seededRandom } from "./terrain-math";

/** 独立木纹与刻纹不包含环境光，场景灯光在运行时统一决定明暗。 */
function makeWood() {
  const random = seededRandom(216);
  const wood = document.createElement("canvas");
  wood.width = 1024;
  wood.height = 512;
  const ctx = wood.getContext("2d")!;
  ctx.fillStyle = "#503522";
  ctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 2400; i++) {
    const y = random() * 512;
    ctx.strokeStyle = `rgba(${random() > 0.5 ? "12,5,2" : "180,117,58"},${random() * 0.22})`;
    ctx.lineWidth = 0.3 + random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      260,
      y + random() * 18,
      630,
      y - random() * 15,
      1024,
      y + random() * 8,
    );
    ctx.stroke();
  }
  // 雕刻回纹作为凹凸图使用，避免仅靠纯色几何体模拟古旧木盒。
  const lid = document.createElement("canvas");
  lid.width = 1024;
  lid.height = 512;
  const lidCtx = lid.getContext("2d")!;
  lidCtx.drawImage(wood, 0, 0);
  lidCtx.strokeStyle = "#a48650";
  lidCtx.lineWidth = 5;
  lidCtx.strokeRect(34, 35, 956, 442);
  lidCtx.lineWidth = 2;
  lidCtx.strokeRect(49, 50, 926, 412);
  for (let i = 0; i < 24; i++) {
    const x = 64 + i * 37;
    for (const y of [68, 418]) {
      lidCtx.beginPath();
      lidCtx.moveTo(x, y);
      lidCtx.lineTo(x + 25, y);
      lidCtx.lineTo(x + 25, y + 22);
      lidCtx.lineTo(x + 7, y + 22);
      lidCtx.lineTo(x + 7, y + 8);
      lidCtx.lineTo(x + 17, y + 8);
      lidCtx.stroke();
    }
  }
  lidCtx.strokeStyle = "#bd9a5e";
  lidCtx.lineWidth = 3;
  lidCtx.strokeRect(102, 129, 820, 253);
  lidCtx.font = "76px STKaiti, KaiTi, serif";
  lidCtx.fillStyle = "#c4a56a";
  lidCtx.textAlign = "center";
  lidCtx.textBaseline = "middle";
  lidCtx.fillText("般 若 波 罗 蜜", 512, 259);
  // 云雷纹围绕咒文形成浮雕；保持盒盖闭合，金光只由接缝透出。
  lidCtx.strokeStyle = "#9e7843";
  lidCtx.lineWidth = 3;
  for (let x = 105; x < 940; x += 94) {
    for (const y of [105, 400]) {
      lidCtx.beginPath();
      lidCtx.moveTo(x - 20, y);
      lidCtx.bezierCurveTo(x - 30, y - 25, x + 20, y - 25, x + 19, y);
      lidCtx.bezierCurveTo(x + 15, y + 13, x, y + 12, x, y);
      lidCtx.stroke();
    }
  }
  const woodTexture = new THREE.CanvasTexture(wood);
  const lidTexture = new THREE.CanvasTexture(lid);
  woodTexture.colorSpace = lidTexture.colorSpace = THREE.SRGBColorSpace;
  woodTexture.anisotropy = lidTexture.anisotropy = 4;
  return { woodTexture, lidTexture };
}

/** 沿用闭合长方形宝盒造型；铜饰提高粗糙度，避免均匀的商品展示亮边。 */
export function createChest() {
  const textures = makeWood();
  const wood = new THREE.MeshStandardMaterial({
    map: textures.woodTexture,
    bumpMap: textures.woodTexture,
    bumpScale: 0.025,
    roughness: 0.86,
  });
  const lidWood = new THREE.MeshStandardMaterial({
    map: textures.lidTexture,
    bumpMap: textures.lidTexture,
    bumpScale: 0.024,
    roughness: 0.8,
  });
  const bronze = new THREE.MeshStandardMaterial({
    color: 0x927044,
    roughness: 0.72,
    metalness: 0.48,
  });
  const darkBronze = new THREE.MeshStandardMaterial({
    color: 0x4e3b25,
    roughness: 0.85,
    metalness: 0.35,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd291,
    transparent: true,
    opacity: 0.85,
    toneMapped: false,
  });
  const box = new THREE.Group();
  // 最低盒脚为局部 y=-0.23，整体抬高同样距离后四脚恰好贴地。
  box.position.y = 0.23;
  box.rotation.y = -0.24;
  function cuboid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Group = box,
    rounded = false,
  ) {
    const mesh = new THREE.Mesh(
      rounded
        ? new RoundedBoxGeometry(w, h, d, 2, 0.035)
        : new THREE.BoxGeometry(w, h, d),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  cuboid(3.55, 0.66, 1.53, 0, 0.25, 0, wood, box, true);
  cuboid(3.64, 0.17, 1.62, 0, 0.71, 0, wood, box, true);
  cuboid(3.46, 0.012, 1.43, 0, 0.805, 0, lidWood);
  // 铜包边沿着木盒四边布置，保持电影道具式的细长比例。
  for (const y of [-0.07, 0.56, 0.8]) {
    for (const z of [-0.79, 0.79]) cuboid(3.64, 0.035, 0.038, 0, y, z, bronze);
    for (const x of [-1.8, 1.8]) cuboid(0.035, 0.035, 1.6, x, y, 0, bronze);
  }
  for (const x of [-1.52, 1.52]) {
    for (const z of [-0.79, 0.79])
      cuboid(0.14, 0.88, 0.036, x, 0.36, z, bronze);
    cuboid(0.14, 0.025, 1.6, x, 0.815, 0, bronze);
    for (const z of [-0.57, 0.57])
      cuboid(0.25, 0.16, 0.25, x, -0.15, z, darkBronze, box, true);
  }
  for (const z of [-0.802, 0.802])
    cuboid(3.4, 0.014, 0.016, 0, 0.6, z, glowMaterial);
  for (const x of [-1.79, 1.79])
    cuboid(0.014, 0.014, 1.52, x, 0.6, 0, glowMaterial);
  // 前盖装饰刻纹使用独立浅浮雕，强化侧视角下的木盒质感。
  for (const x of [-1.05, -0.64, 0.64, 1.05]) {
    const diamond = cuboid(0.24, 0.24, 0.018, x, 0.24, 0.785, darkBronze);
    diamond.rotation.z = Math.PI / 4;
    const inset = cuboid(0.16, 0.16, 0.025, x, 0.24, 0.798, bronze);
    inset.rotation.z = Math.PI / 4;
    cuboid(0.07, 0.07, 0.03, x, 0.24, 0.815, wood);
  }
  const seal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.225, 0.225, 0.045, 40),
    darkBronze,
  );
  seal.rotation.x = Math.PI / 2;
  seal.position.set(0, 0.29, 0.82);
  box.add(seal);
  for (const radius of [0.22, 0.16]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.014, 6, 40),
      bronze,
    );
    ring.position.set(0, 0.29, 0.855);
    box.add(ring);
  }
  cuboid(0.085, 0.27, 0.055, 0, 0.46, 0.88, bronze, box, true);
  const centerGem = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 8),
    glowMaterial,
  );
  centerGem.scale.z = 0.3;
  centerGem.position.set(0, 0.29, 0.9);
  box.add(centerGem);
  const rivets = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.027, 6, 4),
    bronze,
    24,
  );
  const dummy = new THREE.Object3D();
  let rivetIndex = 0;
  for (const x of [-1.52, 1.52])
    for (const y of [0, 0.22, 0.47, 0.72])
      for (const z of [-0.82, 0.82]) {
        dummy.position.set(x, y, z);
        dummy.scale.set(1, 1, 0.6);
        dummy.updateMatrix();
        rivets.setMatrixAt(rivetIndex++, dummy.matrix);
      }
  for (const x of [-1.52, 1.52])
    for (const z of [-0.6, -0.2, 0.2, 0.6]) {
      dummy.position.set(x, 0.85, z);
      dummy.scale.set(1, 0.6, 1);
      dummy.updateMatrix();
      rivets.setMatrixAt(rivetIndex++, dummy.matrix);
    }
  box.add(rivets);

  return { box, glowMaterial };
}
