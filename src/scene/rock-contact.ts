import * as THREE from "three";
import type { Initialization } from "./initialization.ts";
import { seededRandom } from "./terrain-math.ts";
import { obstacleFootprint, overlapsChestScenery } from "./terrain-clearance.ts";
import { selectChestPlacement } from "./chest-placement.ts";
import { createGroundSampler } from "./ground-sampler.ts";
import { createMeadowBlade, vegetationReach } from "./meadow-geometry.ts";
import { createGrassMaterials } from "./grass-material.ts";

type RockLayout = { matrices: ArrayLike<number>; count: number; ground: THREE.BufferGeometry };

/** 右侧石边补少量同款弯叶，另用局部权重恢复真实投影的深度；权重本身不绘制阴影。 */
export async function createRockContacts(init: Initialization, rockGeometry: THREE.BufferGeometry,
  layouts: readonly RockLayout[]) {
  const geometry = init.track(createMeadowBlade(7));
  const wind = createGrassMaterials({ strength: .75 });
  init.track(wind.material); init.track(wind.depth);
  const caches: { matrices: number[]; colors: number[]; bounds: THREE.Box3; mask: THREE.DataTexture }[] = [];
  const maskBounds = new THREE.Vector4(-17, -9, 34, 28), maskSize = 256;
  const matrix = new THREE.Matrix4(), dummy = new THREE.Object3D(), color = new THREE.Color();
  const p = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const probe = new THREE.Mesh(rockGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  // 射线仅用于初始化，探针的临时材质提前登记，取消场景时也能统一释放。
  init.track(probe.material);
  for (let layoutIndex = 0; layoutIndex < layouts.length; layoutIndex++) {
    const layout = layouts[layoutIndex], mobile = layoutIndex === 1;
    init.phase = `rock-contact-${mobile ? "mobile" : "desktop"}`;
    const sampleGround = createGroundSampler(layout.ground), placement = selectChestPlacement(mobile);
    const matrices: number[] = [], colors: number[] = [], bounds = new THREE.Box3();
    const pixels = new Uint8Array(maskSize * maskSize);
    for (let i = 0; i < layout.count; i++) {
      const pause = init.checkpoint(); if (pause) await pause;
      matrix.fromArray(layout.matrices, i * 16).decompose(p, rotation, scale);
      // 仅细化画面右侧靠近宝盒的岩块，远山、左侧草坡和原草甸随机序列完全不变。
      if (p.x < 1.5 || p.z < -3 || scale.x < .25) continue;
      const polygon = obstacleFootprint(rockGeometry.attributes.position.array, matrix.elements);
      const random = seededRandom(9361 + i * 137);
      probe.matrixWorld.copy(matrix);
      const edges = polygon.map((a, j) => {
        const b = polygon[(j + 1) % polygon.length];
        return { a, b, length: Math.hypot(b.x - a.x, b.z - a.z) };
      });
      const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
      const tufts = Math.ceil(perimeter * 4.5);
      for (let tuft = 0; tuft < tufts; tuft++) {
        // 石面射线检测按草簇分批，低性能设备也能及时取消初始化和处理输入。
        const pause = init.checkpoint(); if (pause) await pause;
        let distance = (tuft + random()) / tufts * perimeter;
        const edge = edges.find(edge => { if (distance <= edge.length) return true; distance -= edge.length; return false; })!;
        const nx = (edge.b.z - edge.a.z) / edge.length, nz = -(edge.b.x - edge.a.x) / edge.length;
        // 朝向宝盒的一侧稍密，其余边缘保留自然断续，避免围成等高草圈。
        if (random() > (nx < -.2 ? .95 : .65)) continue;
        const t = distance / edge.length, gap = .025 + random() * .065;
        const cx = edge.a.x + (edge.b.x - edge.a.x) * t + nx * gap;
        const cz = edge.a.z + (edge.b.z - edge.a.z) * t + nz * gap;
        const leaves = 4 + Math.floor(random() * 5);
        for (let leaf = 0; leaf < leaves; leaf++) {
          const x = cx + (random() - .5) * .085, z = cz + (random() - .5) * .085;
          const y = sampleGround(x, z);
          const height = Math.min(.13 + random() * .25, scale.y * 1.05);
          const bladeScale = height / .57, lean = (random() - .5) * .5;
          const reach = vegetationReach(bladeScale, lean, .75);
          if (overlapsChestScenery(x, z, reach, placement)) continue;
          // 根部必须位于真实地面且不能埋进石面；叶尖允许轻搭石边，打散连续切线。
          origin.set(x, y + 3, z); ray.set(origin, down);
          if (ray.intersectObject(probe, false).some(hit => hit.point.y > y + .012)) continue;
          dummy.position.set(x, y - .004, z);
          dummy.rotation.set(0, random() * Math.PI * 2, lean);
          dummy.scale.set(bladeScale * (.52 + random() * .5), bladeScale, bladeScale);
          dummy.updateMatrix(); matrices.push(...dummy.matrix.elements);
          color.setHSL(.25 + random() * .035, .34 + random() * .16, .18 + random() * .07);
          colors.push(color.r, color.g, color.b);
          bounds.expandByPoint(new THREE.Vector3(x - reach, y - .01, z - reach));
          bounds.expandByPoint(new THREE.Vector3(x + reach, y + height + reach, z + reach));
        }
      }
      // 低分辨率权重只控制现有月光阴影的浓淡；不改变光向，也不附加椭圆黑色贴片。
      const radius = Math.max(...polygon.map(v => Math.hypot(v.x - p.x, v.z - p.z))) + .65;
      const minX = Math.max(0, Math.floor((p.x - radius - maskBounds.x) / maskBounds.z * maskSize));
      const maxX = Math.min(maskSize - 1, Math.ceil((p.x + radius - maskBounds.x) / maskBounds.z * maskSize));
      const minZ = Math.max(0, Math.floor((p.z - radius - maskBounds.y) / maskBounds.w * maskSize));
      const maxZ = Math.min(maskSize - 1, Math.ceil((p.z + radius - maskBounds.y) / maskBounds.w * maskSize));
      for (let row = minZ; row <= maxZ; row++) for (let col = minX; col <= maxX; col++) {
        const x = maskBounds.x + (col + .5) / maskSize * maskBounds.z;
        const z = maskBounds.y + (row + .5) / maskSize * maskBounds.w;
        const weight = 1 - THREE.MathUtils.smoothstep(Math.hypot(x - p.x, z - p.z), radius * .55, radius);
        const index = row * maskSize + col;
        pixels[index] = Math.max(pixels[index], Math.round(weight * 255));
      }
    }
    const mask = init.track(new THREE.DataTexture(pixels, maskSize, maskSize, THREE.RedFormat));
    mask.magFilter = mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;
    caches.push({ matrices, colors, bounds, mask });
  }
  init.release(probe.material);
  const capacity = Math.max(1, ...caches.map(cache => cache.matrices.length / 16));
  const mesh = new THREE.InstancedMesh(geometry, wind.material, capacity);
  mesh.name = "terrain-rock-grass";
  mesh.customDepthMaterial = wind.depth;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const shadowMask = { value: caches[0].mask };
  const shadowBounds = caches.reduce((bounds, cache) => bounds.union(cache.bounds), new THREE.Box3());
  let previousMobile: boolean | undefined;
  function setQuality(mobile: boolean) {
    if (previousMobile === mobile) return;
    const cache = caches[mobile ? 1 : 0];
    mesh.instanceMatrix.array.set(cache.matrices); mesh.instanceColor!.array.set(cache.colors);
    mesh.count = cache.matrices.length / 16;
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor!.needsUpdate = true;
    mesh.boundingBox = cache.bounds.clone(); mesh.boundingSphere = cache.bounds.getBoundingSphere(new THREE.Sphere());
    shadowMask.value = cache.mask;
    previousMobile = mobile;
  }
  setQuality(false);
  return { mesh, shadowMask, maskBounds, shadowBounds, setQuality, update: wind.update };
}
