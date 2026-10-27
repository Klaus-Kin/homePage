import * as THREE from "three";
import { Initialization } from "./initialization";
import { ownTree } from "./resources";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { seededRandom } from "./terrain-math";
import { engrave } from "./chest-engraving";
import { chestPose } from "./chest-motion";
import { glowTexture } from "./textures";

/** 灰黑旧木的颜色与高度分别生成；纵向木纹、细裂、划伤和磨边都参与实际光照。 */
async function makeWood(face: "plain" | "spell" | "name" | "return", init: Initialization) {
  init.phase = `wood-${face}`;
  const random = seededRandom(face === "plain" ? 319 : 216);
  const color = document.createElement("canvas"), height = document.createElement("canvas"),
    emission = document.createElement("canvas");
  color.width = height.width = emission.width = 1536;
  color.height = height.height = emission.height = face === "plain" ? 512 : 256;
  const ctx = color.getContext("2d")!, bump = height.getContext("2d")!,
    glow = emission.getContext("2d")!;
  glow.fillStyle = "#000000"; glow.fillRect(0, 0, emission.width, emission.height);
  const h = color.height;
  ctx.fillStyle = "#64635b"; ctx.fillRect(0, 0, 1536, h);
  bump.fillStyle = "#909090"; bump.fillRect(0, 0, 1536, h);
  // 不规则浅灰磨斑打散长条木纹，粗糙木质不会呈现拉丝金属的整齐反射。
  for (let i = 0; i < 190; i++) {
    if (i % 16 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    const x = random() * 1536, y = random() * h, radius = 12 + random() * 75;
    const stain = ctx.createRadialGradient(x, y, 0, x, y, radius);
    stain.addColorStop(0, random() > 0.5 ? "#a9a59535" : "#12151038");
    stain.addColorStop(1, "#72706600");
    ctx.save(); ctx.translate(x, y); ctx.scale(2.6, 0.6); ctx.translate(-x, -y);
    ctx.fillStyle = stain; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }
  for (let i = 0; i < 2600; i++) {
    if (i % 16 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    const y = random() * h, x = random() * 1536, length = 40 + random() * 700;
    const light = random() > 0.48;
    for (const [context, isHeight] of [[ctx, false], [bump, true]] as const) {
      context.strokeStyle = isHeight ? `rgba(${light ? "210,210,210" : "45,45,45"},0.14)`
        : `rgba(${light ? "156,150,132" : "15,16,14"},${0.06 + random() * 0.16})`;
      context.lineWidth = 0.4 + random() * 1.7;
      context.beginPath(); context.moveTo(x, y);
      context.bezierCurveTo(x + length * 0.3, y + 3, x + length * 0.7, y - 5, x + length, y + 1);
      context.stroke();
    }
  }
  // 稀疏斜向磨痕与边角露出的浅木色避免规则条纹和均匀包边。
  for (let i = 0; i < 130; i++) {
    if (i % 16 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    const x = random() * 1536, y = random() * h;
    ctx.strokeStyle = `rgba(186,177,152,${0.06 + random() * 0.15})`;
    ctx.lineWidth = 0.5 + random();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + random() * 160, y - random() * 16); ctx.stroke();
  }
  for (let i = 0; i < 170; i++) {
    if (i % 16 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    const x = random() * 1536, y = random() > 0.5 ? random() * 9 : h - random() * 9;
    ctx.fillStyle = `rgba(159,143,114,${random() * 0.35})`;
    ctx.fillRect(x, y, random() * 35, 1 + random() * 2);
  }
  // 三种纹理同步生成并旋转；展开侧面补偿真实转轴带来的倒置，字形本身不镜像。
  if (face === "spell") engrave(ctx, bump, glow, "般若波羅蜜", 245, 46, 156, 180);
  if (face === "name") engrave(ctx, bump, glow, "回到未來", 398, 46, 154, 190);
  if (face === "return") engrave(ctx, bump, glow, "時光倒流", 398, 46, 154, 190,
    { reverse: true, rotation: Math.PI });
  const map = init.track(new THREE.CanvasTexture(color)),
    bumpMap = init.track(new THREE.CanvasTexture(height)),
    emissiveMap = face === "plain" ? null : init.track(new THREE.CanvasTexture(emission));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = bumpMap.anisotropy = 4;
  // 遮罩使用线性黑白数据；0.25 的常亮发光仅作用于金色字槽。
  if (emissiveMap) emissiveMap.anisotropy = 4;
  const material = init.track(new THREE.MeshStandardMaterial({ map, bumpMap,
    bumpScale: 0.018, roughness: 0.94, emissiveMap,
    emissive: face === "plain" ? 0x000000 : 0xe9b95d, emissiveIntensity: 0.25 }));
  // 材质名标明刻字所在面，便于离线检查 UV 与转轴组合后的真实朝向。
  material.name = `wood-${face}`;
  return material;
}

/** 上下两条木质半盒通过左短端水平铰链相连，闭合后形成横放的完整长盒。 */
export async function createChest(init = new Initialization()) {
  const wood = await makeWood("plain", init), spellWood = await makeWood("spell", init),
    nameWood = await makeWood("name", init), returnWood = await makeWood("return", init);
  // 最后一张刻字贴图与实体几何分开提交，避免两段短工作叠成同一个长任务。
  await init.checkpoint(true);
  init.phase = "chest-geometry";
  const inner = new THREE.MeshStandardMaterial({ map: wood.map, bumpMap: wood.bumpMap,
    bumpScale: 0.012, color: 0xb0a18c, roughness: 0.98,
    emissive: 0xffe1a6, emissiveIntensity: 0.018 });
  const box = ownTree(init, new THREE.Group()), openingPivot = new THREE.Group();
  // 为上翻后落到左侧的双倍长度预留空间；底盒在整个动画中保持落地且不平移。
  // 长边左右摆放，局部右端铰链转到画面左侧；上半盒真正抬离地面。
  box.rotation.y = Math.PI;
  box.position.x = 1;
  box.scale.setScalar(0.64);
  for (const texture of [spellWood.map!, spellWood.bumpMap!, spellWood.emissiveMap!,
    nameWood.map!, nameWood.bumpMap!, nameWood.emissiveMap!,
    returnWood.map!, returnWood.bumpMap!, returnWood.emissiveMap!]) {
    texture.center.set(0.5, 0.5); texture.rotation = Math.PI;
  }
  openingPivot.position.set(1.93, 0.61, 0);
  box.add(openingPivot);
  function cuboid(w: number, h: number, d: number, x: number, y: number, z: number,
    material: THREE.Material | THREE.Material[], parent: THREE.Group = box, rounded = false) {
    const mesh = new THREE.Mesh(rounded ? new RoundedBoxGeometry(w, h, d, 3, 0.014)
      : new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  const rim = new THREE.MeshStandardMaterial({ color: 0x283446, roughness: 0.94 });
  async function half(sign: number, topWood: THREE.Material, parent: THREE.Group) {
    const group = new THREE.Group();
    // 既有侧槽实体转成上下槽：底盒开口朝上、上盒开口朝下；上盒原点跟随水平铰链。
    group.rotation.x = -Math.PI / 2;
    group.position.set(parent === openingPivot ? -1.93 : 0,
      parent === openingPivot ? 0 : 0.61, 0.22);
    parent.add(group);
    // 上盖外表面闭合朝天，翻转 180° 后朝地；与前侧刻字分用独立面材质。
    const outer = cuboid(3.86, 0.44, 0.065, 0, 0.22, sign * 0.5775,
      sign > 0 ? [wood, wood, wood, wood, spellWood, inner] : [wood, wood, wood, wood, inner, wood], group);
    outer.name = sign > 0 ? "lid-outer-spell" : "base-floor";
    // 磨圆边缘的细分几何各自切批，保留圆角精度并避免弱 CPU 上连续构造阻塞。
    await init.checkpoint(true);
    cuboid(3.86, 0.055, 0.604, 0, 0.4125, sign * 0.308,
      [wood, wood, topWood, inner, wood, wood], group, true);
    await init.checkpoint(true);
    cuboid(3.86, 0.055, 0.604, 0, 0.0275, sign * 0.308, wood, group, true);
    await init.checkpoint(true);
    for (const x of [-1.8975, 1.8975])
      cuboid(0.065, 0.33, 0.604, x, 0.22, sign * 0.308, wood, group);
    // 内槽的窄边沿来自第二张参考图；不封住槽口，旋开后可直接看到真实凹腔。
    for (const y of [0.064, 0.376])
      cuboid(3.72, 0.018, 0.025, 0, y, sign * 0.025, rim, group);
    for (const x of [-1.85, 1.85])
      cuboid(0.018, 0.312, 0.025, x, 0.22, sign * 0.025, rim, group);
    return group;
  }
  const fixedHalf = await half(-1, nameWood, box);
  const movingHalf = await half(1, returnWood, openingPivot);
  // 水平销轴贯穿短端厚度，实体铰链与上翻轴重合。
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.44, 12),
    new THREE.MeshStandardMaterial({ color: 0x57564c, roughness: 0.85, metalness: 0.25 }));
  hinge.rotation.x = Math.PI / 2;
  hinge.position.set(1.93, 0.61, 0); hinge.castShadow = true; box.add(hinge);
  const lightAnchor = new THREE.Object3D();
  lightAnchor.position.set(0, 0.61, 0); box.add(lightAnchor);
  // 三个低强度光源把内腔照匀，避免单点在盒壁上形成刺眼圆斑。
  const cavityLights = [-1.1, 0, 1.1].map((x) => {
    const light = new THREE.PointLight(0xffe7be, 0.35, 6, 2);
    light.position.x = x; lightAnchor.add(light); return light;
  });
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffe9c8,
    transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.65, 0.27), glowMaterial);
  glow.position.set(0, 0.22, -0.065); fixedHalf.add(glow);
  const movingGlow = glow.clone();
  movingGlow.position.z = 0.065;
  movingHalf.add(movingGlow);
  const mouthGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowMaterial.map, color: 0xffe9c8, transparent: true, opacity: 0.3,
    // 光晕模拟盒口散射，只柔化木板边缘；实体与光束仍正常参与深度测试。
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  mouthGlow.scale.set(3.4, 0.7, 1); lightAnchor.add(mouthGlow);
  // 羽化光片根部限制在盒口内，垂直向外散开；减少动态时完全关闭光束。
  const beamMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { strength: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float strength;
      void main(){ float edge=pow(sin(vUv.x*3.14159265),2.0);
      float heightFade=pow(1.0-vUv.y,2.2);
      gl_FragColor=vec4(vec3(1.0,0.94,0.81),edge*heightFade*strength); }`,
  });
  const beams = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -1.65, 0, 0, 1.65, 0, 0, -2.9, 3.3, 0, 2.9, 3.3, 0,
    ], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const mesh = new THREE.Mesh(geometry, beamMaterial);
    mesh.position.set(0, 0.61, -0.12 + i * 0.12); mesh.rotation.y = (i - 1) * 0.12;
    beams.add(mesh);
  }
  box.add(beams);
  const bounds = new THREE.Box3();
  function update(lidProgress: number, glowProgress: number, reduced: boolean) {
    const pose = chestPose(lidProgress), moved = openingPivot.rotation.z !== -pose.angle;
    openingPivot.rotation.z = -pose.angle;
    const b = pose.bounds;
    bounds.min.set(b.minX, b.minY, b.minZ); bounds.max.set(b.maxX, b.maxY, b.maxZ);
    // 小型销轴和磨圆边缘也纳入保守边界。
    bounds.expandByScalar(0.03);
    cavityLights.forEach((light) => { light.intensity = 0.35 + glowProgress * 16; });
    glowMaterial.opacity = 0.22 + glowProgress * 0.78;
    mouthGlow.material.opacity = 0.3 + glowProgress * 0.65;
    beamMaterial.uniforms.strength.value = glowProgress * 0.22;
    beams.visible = !reduced && glowProgress > 0;
    box.updateMatrixWorld(true);
    return moved;
  }
  update(0, 0, false);
  return { box, fixedHalf, movingHalf, openingPivot, lightAnchor, bounds, glowMaterial, update };
}
