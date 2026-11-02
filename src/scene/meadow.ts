import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sceneConfig } from "../config.ts";
import type { Initialization } from "./initialization.ts";
import { ownTree } from "./resources.ts";
import { computeTerrain } from "./terrain-worker-client.ts";
import { leftMeadowBudget } from "./meadow-distribution.ts";
import { createMeadowBlade, createWildflower, createSeedHead } from "./meadow-geometry.ts";
import { createGrassMaterials } from "./grass-material.ts";

type Footprint = readonly { x: number; z: number }[];
type Cache = { matrices: Float32Array; colors: Float32Array; count: number; baseCount: number; bounds: THREE.Box3 };

/** 花株的花瓣、弯茎及两个风摆端点统一进入避让包络。 */
export const flowerReach = (scale: number) => scale * (.12 + .65 ** 2 * .24 * 1.3) + .008;
export const seedReach = (scale: number) => scale * (.085 + .96 ** 2 * .24 * .8) + .008;

/** 仅实例化真实叶片，不用草照片铺地；两种构图各自缓存贴地、避让和包围体。 */
export async function createMeadow(init: Initialization, ground: THREE.BufferGeometry,
  desktopGround: THREE.BufferGeometry, footprints: readonly Footprint[], initialMobile = false) {
  const group = ownTree(init, new THREE.Group());
  group.name = "terrain-meadow";

  // 岩石种子、顺序和布局完全沿用地形模块；预筛矩形只减少碰撞计算量，不改变凸包判断。
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
  const entries: { mesh: THREE.InstancedMesh; caches: Map<boolean, Cache>;
    pending: Map<boolean, Promise<Cache>>; wind: ReturnType<typeof createGrassMaterials> }[] = [];
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
    const caches = new Map<boolean, Cache>();
    entries.push({ mesh, caches, pending: new Map(), wind });
  }
  let previousMobile: boolean | undefined, previousWide: boolean | undefined;
  let detail = 0, revision = 0;
  async function setQuality(mobile: boolean, wide = !mobile) {
    const request = ++revision;
    if (previousMobile === mobile && previousWide === wide) return;
    for (const [index, entry] of entries.entries()) {
      if (!entry.caches.has(mobile)) {
        const definition = definitions[index];
        // 连续停靠/旋转可能在同档位尚未完成时再次请求；复用进行中的生成，避免后台堆积重复大数组。
        let pending = entry.pending.get(mobile);
        if (!pending) {
          init.phase = `meadow-${definition.kind}-${mobile ? "mobile" : "desktop"}`;
          pending = computeTerrain({ type: "meadow", kind: definition.kind, mobile,
            seed: definition.seed, strength: definition.strength, footprints,
            ground: (mobile ? ground : desktopGround).attributes.position.array as Float32Array }, init)
            .then(data => {
              const bounds = new THREE.Box3(new THREE.Vector3().fromArray(data.min), new THREE.Vector3().fromArray(data.max));
              const cache = { ...data, bounds };
              entry.caches.set(mobile, cache); shadowBounds.union(bounds);
              return cache;
            }).finally(() => entry.pending.delete(mobile));
          entry.pending.set(mobile, pending);
        }
        await pending;
      }
      if (request !== revision) return;
    }
    for (const { mesh, caches } of entries) {
      const cache = caches.get(mobile)!;
      mesh.boundingBox = cache.bounds.clone(); mesh.boundingSphere = cache.bounds.getBoundingSphere(new THREE.Sphere());
    }
    previousMobile = mobile;
    previousWide = wide;
    setDetail(detail);
  }
  function setDetail(level: number) {
    detail = level;
    if (previousMobile === undefined) return;
    for (const { mesh, caches } of entries) {
      const cache = caches.get(previousMobile)!;
      const fraction = [1, .85, .65, .45][detail];
      const base = Math.ceil(cache.baseCount * fraction);
      const supplemental = previousMobile && !previousWide ? 0 : Math.ceil((cache.count - cache.baseCount) * fraction);
      if (!mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      if (fraction === 1) {
        // 默认档位直接连续复制，避免首次启动为数万实例创建临时子数组。
        mesh.instanceMatrix.array.set(cache.matrices.subarray(0, (base + supplemental) * 16));
        mesh.instanceColor.array.set(cache.colors.subarray(0, (base + supplemental) * 3));
      } else for (let i = 0; i < base + supplemental; i++) {
        const source = i < base ? Math.floor(i * cache.baseCount / base)
          : cache.baseCount + Math.floor((i - base) * (cache.count - cache.baseCount) / supplemental);
        // 抽稀保留均匀分布，并用数值复制避免换档时制造大量短命视图和 GC 停顿。
        for (let component = 0; component < 16; component++)
          mesh.instanceMatrix.array[i * 16 + component] = cache.matrices[source * 16 + component];
        for (let component = 0; component < 3; component++)
          mesh.instanceColor.array[i * 3 + component] = cache.colors[source * 3 + component];
      }
      mesh.count = base + supplemental; mesh.userData.baseCount = base; mesh.userData.leftCount = supplemental;
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    }
  }
  await setQuality(initialMobile);
  return { group, shadowBounds, setQuality, setDetail,
    update(time: number, reduced: boolean) {
      let changed = false;
      // 每个材质都更新，不用短路或运算遗漏后续花株；深度通道与颜色通道持有同一组时间对象。
      for (const { wind } of entries) if (wind.update(time, reduced)) changed = true;
      return changed;
    },
  };
}
