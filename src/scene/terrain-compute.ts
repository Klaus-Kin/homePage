import * as THREE from "three";
import type { Initialization } from "./initialization.ts";
import { createPlane, computeNormals } from "./geometry.ts";
import { fbm, mountainHeight, mountainColumn, seededRandom } from "./terrain-math.ts";
import { sceneConfig } from "../config.ts";
import { createGroundSampler } from "./ground-sampler.ts";
import { overlapsChestScenery, overlapsFootprint } from "./terrain-clearance.ts";
import { selectChestPlacement } from "./chest-placement.ts";
import { sampleMeadowBlade, sampleLeftMeadowBlade, leftMeadowBudget } from "./meadow-distribution.ts";
import { vegetationReach } from "./meadow-geometry.ts";
import type { MeadowJob } from "./terrain-worker-types.ts";

export const flowerReach = (scale: number) => scale * (.12 + .65 ** 2 * .24 * 1.3) + .008;
export const seedReach = (scale: number) => scale * (.085 + .96 ** 2 * .24 * .8) + .008;
/** 山体计算与原生成顺序一致；返回独占数组供线程转移，不带 GPU 或场景对象。 */
export async function computeMountain(layer: number, mobile: boolean, init: Initialization) {
  init.phase = `mountain-${layer}`;
  const columns = mobile ? (layer < 2 ? 170 : 110) : layer < 2 ? 420 : 270;
  // 近层包含独立支峰，纵向细分只增加在这一层；移动端仍有独立的顶点上限。
  const rows = layer === 0 ? (mobile ? 56 : 130) : mobile ? 36 : 76;
  const geometry = await createPlane(280, 52, columns, rows, init);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const columnProfiles: ReturnType<typeof mountainColumn>[] = [];
  for (let i = 0; i < positions.count; i++) {
    if (i % 32 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    // 把同样数量的横向顶点集中到主要可见山群，外围仍延伸至原有边界。
    const u = positions.getX(i) / 140;
    positions.setX(i, Math.sign(u) * Math.pow(Math.abs(u), 1.5) * 140);
    const column = i % (columns + 1);
    columnProfiles[column] ??= mountainColumn(positions.getX(i), layer);
    positions.setY(
      i,
      mountainHeight(positions.getX(i), positions.getZ(i), layer, columnProfiles[column]),
    );
  }
  const pause = init.checkpoint(); if (pause) await pause;
  await computeNormals(geometry, init);
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(positions.count * 3),
    color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    if (i % 32 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    // 陡壁裸岩、缓坡暗植被和细碎岩层随真实坡度变化；不把远近层统一涂成蓝色。
    const cliff = 1 - Math.max(0, normals.getY(i));
    const grain = fbm(x * 1.6 + layer * 13, z * 1.9);
    const strata = Math.sin(y * 5 + fbm(x * 0.15, z * 0.2) * 8) * 0.025;
    color.setHSL(
      0.55 + cliff * 0.04,
      0.13 + (1 - cliff) * 0.1,
      // 提高冷蓝中间调，月光面与雾中的山脊保留参考图的蓝灰层次。
      0.34 + cliff * 0.15 + grain * 0.13 + strata,
    );
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const data = { position: geometry.attributes.position.array as Float32Array,
    normal: geometry.attributes.normal.array as Float32Array, uv: geometry.attributes.uv.array as Float32Array,
    color: geometry.attributes.color.array as Float32Array,
    index: geometry.index!.array as Uint16Array | Uint32Array };
  init.release(geometry);
  return data;
}

/** 只生成请求的草甸档位，固定随机序列、真实三角面采样和碰撞边界保持原样。 */
export async function computeMeadow(job: MeadowJob, init: Initialization) {
  const { kind, mobile, seed, strength, footprints } = job;
  const ground = new THREE.BufferGeometry();
  ground.setAttribute("position", new THREE.BufferAttribute(job.ground, 3));
  const obstacles = footprints.map(polygon => ({ polygon,
    minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
    minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z)),
  }));
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const lowerCorner = new THREE.Vector3(), upperCorner = new THREE.Vector3();
  const preset = sceneConfig.quality[mobile ? "mobile" : "desktop"];
  const baseBudget = preset[kind], budget = baseBudget + leftMeadowBudget[mobile ? "mobile" : "desktop"][kind];
  const placement = selectChestPlacement(mobile);
  // 原实例先生成完整前缀，补草只消耗独立序列；既有草叶、花株与岩石不会重新洗牌。
  const sampleGround = createGroundSampler(ground), baseRandom = seededRandom(seed),
    leftRandom = seededRandom(seed + 59021);
  const matrices = new Float32Array(budget * 16), colors = new Float32Array(budget * 3);
  const bounds = new THREE.Box3();
  const points: { x: number; z: number }[] = [];
  let count = 0;
  for (let attempt = 0; count < budget && attempt < budget * 35; attempt++) {
    // 每八次尝试让初始化器检查预算；碰撞未通过时也能及时取消和交还主线程。
    if (attempt % 8 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    const supplemental = count >= baseBudget, random = supplemental ? leftRandom : baseRandom;
    let x: number, z: number, scale: number, yaw: number, lean: number, width: number;
    let hue = .26, lightness = .2;
    if (kind === "flowers" || kind === "seeds") {
      x = (random() - .5) * 26; z = -2 + random() * 17;
      const distanceScale = .4 + .6 * Math.max(0, Math.min(1, (z + 1) / 11));
      scale = (kind === "flowers" ? .85 + random() * .55 : .65 + random() * .55) * distanceScale;
      yaw = random() * Math.PI * 2; lean = 0; width = 1;
      // 小花散在草面之间，避免扎堆；草穗可以自然聚散。
      if (kind === "flowers" && points.some(p => Math.hypot(p.x - x, p.z - z) < .85)) continue;
    } else {
      const sample = supplemental ? sampleLeftMeadowBlade(random, kind, mobile) : sampleMeadowBlade(random, kind);
      if (!sample) continue;
      ({ x, z, yaw, lean, width, hue, lightness } = sample);
      scale = sample.height / .6;
    }
    if (mobile && !supplemental) {
      // 竖屏只看得到中央窄幅地形，把预算集中到真正可见的草坡；不能把桌面密度平均摊到屏外。
      x *= .42;
      if (kind !== "flowers" && kind !== "seeds") z = -2 + (z + 8) * 18 / 26;
    }
    const radius = kind === "flowers" ? flowerReach(scale)
      : kind === "seeds" ? seedReach(scale) : vegetationReach(scale, lean, strength);
    if (overlapsChestScenery(x, z, radius, placement)) continue;
    if (obstacles.some(o => x + radius >= o.minX && x - radius <= o.maxX &&
      z + radius >= o.minZ && z - radius <= o.maxZ && overlapsFootprint(x, z, radius, o.polygon))) continue;
    const y = sampleGround(x, z) - .004;
    dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, lean);
    dummy.scale.set(scale * width, scale, scale);
    // 实例矩阵直接复制最终姿态，颜色写入既有缓冲；数万株草不再逐个创建临时颜色数组。
    dummy.updateMatrix();
    matrices.set(dummy.matrix.elements, count * 16);
    if (kind === "flowers" || kind === "seeds") color.setRGB(1, 1, 1);
    else color.setHSL(hue, .34 + random() * .16, lightness);
    colors[count * 3] = color.r;
    colors[count * 3 + 1] = color.g;
    colors[count * 3 + 2] = color.b;
    // 直接累积包含风摆的范围，切换画质不再逐个扫描数万片草叶。
    bounds.expandByPoint(lowerCorner.set(x - radius, y - radius, z - radius));
    bounds.expandByPoint(upperCorner.set(x + radius, y + scale * (kind === "seeds" ? 1 : .84) + radius, z + radius));
    if (kind === "flowers") points.push({ x, z });
    count++;
  }
  if (count < budget) throw new Error(`草甸 ${kind} ${mobile ? "手机" : "桌面"} 放置不足：${count}/${budget}`);

  ground.dispose();
  return { matrices, colors, count, baseCount: baseBudget, min: bounds.min.toArray(), max: bounds.max.toArray() };
}
