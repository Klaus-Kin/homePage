import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sceneConfig } from "../config.ts";
import type { Initialization } from "./initialization.ts";
import { ownTree } from "./resources.ts";
import { seededRandom } from "./terrain-math.ts";
import { overlapsChestScenery, overlapsFootprint } from "./terrain-clearance.ts";
import { selectChestPlacement } from "./chest-placement.ts";
import { createGroundSampler } from "./ground-sampler.ts";
import { sampleMeadowBlade, sampleLeftMeadowBlade, leftMeadowBudget } from "./meadow-distribution.ts";
import { createMeadowBlade, createWildflower, createSeedHead, vegetationReach } from "./meadow-geometry.ts";
import { createGrassMaterials } from "./grass-material.ts";

type Footprint = readonly { x: number; z: number }[];
type Cache = { matrices: Float32Array; colors: Float32Array; count: number; baseCount: number; bounds: THREE.Box3 };

/** 花株的花瓣、弯茎及两个风摆端点统一进入避让包络。 */
export const flowerReach = (scale: number) => scale * (.12 + .65 ** 2 * .24 * 1.3) + .008;
export const seedReach = (scale: number) => scale * (.085 + .96 ** 2 * .24 * .8) + .008;

/** 仅实例化真实叶片，不用草照片铺地；两种构图各自缓存贴地、避让和包围体。 */
export async function createMeadow(init: Initialization, ground: THREE.BufferGeometry,
  desktopGround: THREE.BufferGeometry, footprints: readonly Footprint[]) {
  const group = ownTree(init, new THREE.Group());
  group.name = "terrain-meadow";
  const samplers = [createGroundSampler(desktopGround), createGroundSampler(ground)];
  // 岩石种子、顺序和布局完全沿用地形模块；预筛矩形只减少碰撞计算量，不改变凸包判断。
  const obstacles = footprints.map(polygon => ({ polygon,
    minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
    minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z)),
  }));
  // 只有近景长叶保留全部弧线段；亚像素细草降低纵向分段，形态和风场仍完全相同。
  const turfA = createMeadowBlade(3), turfB = createMeadowBlade(3);
  turfB.scale(.8, .85, .85); turfB.rotateY(1.9);
  const turfBlade = init.track(mergeGeometries([turfA, turfB])!);
  turfA.dispose(); turfB.dispose();
  const grassBlade = init.track(createMeadowBlade(7));
  const blade = init.track(createMeadowBlade());
  const definitions = [
    { kind: "turf", name: "terrain-turf", seed: 9127, strength: .35, geometry: turfBlade },
    { kind: "grass", name: "terrain-grass", seed: 2831, strength: .75, geometry: grassBlade },
    { kind: "long", name: "terrain-long-grass", seed: 6481, strength: 1, geometry: blade },
    { kind: "seeds", name: "terrain-seed-heads", seed: 7351, strength: .8, geometry: init.track(createSeedHead()) },
    { kind: "flowers", name: "terrain-flowers", seed: 4239, strength: 1.3, geometry: init.track(createWildflower()) },
  ] as const;
  const entries: { mesh: THREE.InstancedMesh; caches: Cache[]; wind: ReturnType<typeof createGrassMaterials> }[] = [];
  const matrix = new THREE.Matrix4(), dummy = new THREE.Object3D(), color = new THREE.Color();
  const lowerCorner = new THREE.Vector3(), upperCorner = new THREE.Vector3();
  const shadowBounds = new THREE.Box3();
  for (const definition of definitions) {
    const { kind, strength } = definition;
    const capacity = sceneConfig.quality.desktop[kind] + leftMeadowBudget.desktop[kind];
    const wind = createGrassMaterials({ strength, flower: kind === "flowers" });
    const mesh = new THREE.InstancedMesh(definition.geometry, init.track(wind.material), capacity);
    mesh.name = definition.name;
    // 深度通道复用风动变形，且独立登记释放；打开投影后草簇才会在地面留下真实阴影。
    mesh.customDepthMaterial = init.track(wind.depth);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData = { meadowKind: kind, windStrength: strength };
    group.add(mesh);
    const caches: Cache[] = [];
    for (const mobile of [false, true]) {
      init.phase = `meadow-${kind}-${mobile ? "mobile" : "desktop"}`;
      const preset = sceneConfig.quality[mobile ? "mobile" : "desktop"];
      const baseBudget = preset[kind], budget = baseBudget + leftMeadowBudget[mobile ? "mobile" : "desktop"][kind];
      const placement = selectChestPlacement(mobile);
      // 原实例先生成完整前缀，补草只消耗独立序列；既有草叶、花株与岩石不会重新洗牌。
      const sampleGround = samplers[mobile ? 1 : 0], baseRandom = seededRandom(definition.seed),
        leftRandom = seededRandom(definition.seed + 59021);
      const matrices = new Float32Array(capacity * 16), colors = new Float32Array(capacity * 3);
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
        dummy.updateMatrix(); matrix.copy(dummy.matrix);
        matrices.set(matrix.elements, count * 16);
        if (kind === "flowers" || kind === "seeds") color.setRGB(1, 1, 1);
        else color.setHSL(hue, .34 + random() * .16, lightness);
        colors.set([color.r, color.g, color.b], count * 3);
        // 直接累积包含风摆的范围，切换画质不再逐个扫描数万片草叶。
        bounds.expandByPoint(lowerCorner.set(x - radius, y - radius, z - radius));
        bounds.expandByPoint(upperCorner.set(x + radius, y + scale * (kind === "seeds" ? 1 : .84) + radius, z + radius));
        if (kind === "flowers") points.push({ x, z });
        count++;
      }
      if (count < budget) throw new Error(`草甸 ${kind} ${mobile ? "手机" : "桌面"} 放置不足：${count}/${budget}`);
      caches.push({ matrices, colors, count, baseCount: baseBudget, bounds });
      shadowBounds.union(bounds);
    }
    entries.push({ mesh, caches, wind });
  }
  let previousMobile: boolean | undefined, previousWide: boolean | undefined;
  function setQuality(mobile: boolean, wide = !mobile) {
    if (previousMobile === mobile && previousWide === wide) return;
    for (const { mesh, caches } of entries) {
      const cache = caches[mobile ? 1 : 0];
      mesh.instanceMatrix.array.set(cache.matrices);
      if (!mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cache.colors.length), 3);
      mesh.instanceColor.array.set(cache.colors);
      // 轻量画质与相机横向覆盖分开：竖屏沿用原实例数，矮屏及横屏启用追加的左坡实例。
      const baseCount = cache.baseCount;
      mesh.count = mobile && !wide ? baseCount : cache.count;
      mesh.userData.baseCount = baseCount;
      mesh.userData.leftCount = mesh.count - baseCount;
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
      mesh.boundingBox = cache.bounds.clone();
      mesh.boundingSphere = cache.bounds.getBoundingSphere(new THREE.Sphere());
    }
    previousMobile = mobile;
    previousWide = wide;
  }
  setQuality(false);
  return { group, shadowBounds, setQuality,
    update(time: number, reduced: boolean) {
      let changed = false;
      // 每个材质都更新，不用短路或运算遗漏后续花株；深度通道与颜色通道持有同一组时间对象。
      for (const { wind } of entries) if (wind.update(time, reduced)) changed = true;
      return changed;
    },
  };
}
