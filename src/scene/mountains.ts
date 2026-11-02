import * as THREE from "three";
import type { Initialization } from "./initialization";
import { ownTree } from "./resources";
import { computeTerrain } from "./terrain-worker-client.ts";
import { surfaceTexture } from "./textures";
import { addMountainSurface } from "./mountain-surface";

/** 远山单独维护几何细节等级，手机减少顶点但保留相同山脊、材质和光照。 */
export async function createMountains(init: Initialization) {
  const group = ownTree(init, new THREE.Group());
  let lightweight =
    window.innerWidth < 768 ||
    window.innerHeight < 500 ||
    matchMedia("(pointer: coarse)").matches;
  // 远山恢复原来的岩层纹理，近景石头继续使用独立的柔和风化纹理。
  const rock = await surfaceTexture("mountain", init);
  rock.repeat.set(45, 9);

  const geometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
  function geometryFor(layer: number, mobile: boolean) {
    const key = `${mobile}:${layer}`;
    let pending = geometryCache.get(key);
    if (!pending) {
      pending = buildGeometry(layer, mobile).catch(error => { geometryCache.delete(key); throw error; });
      geometryCache.set(key, pending);
    }
    return pending;
  }
  async function buildGeometry(layer: number, mobile: boolean) {
    init.phase = `mountain-${layer}`;
    const data = await computeTerrain({ type: "mountain", layer, mobile }, init);
    const geometry = init.track(new THREE.BufferGeometry());
    for (const name of ["position", "normal", "uv", "color"] as const)
      geometry.setAttribute(name, new THREE.BufferAttribute(data[name], name === "uv" ? 2 : 3));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    return geometry;
  }

  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  for (let layer = 0; layer < 5; layer++) {
    const material = init.track(new THREE.MeshStandardMaterial({
      map: rock,
      bumpMap: rock,
      bumpScale: layer < 2 ? 0.22 : 0.12,
      vertexColors: true,
      roughness: 1,
    }));
    addMountainSurface(material);
    const mesh = new THREE.Mesh(await geometryFor(layer, lightweight), material);
    mesh.position.set(
      layer % 2 ? -12 : 10,
      -2 - layer * 0.35,
      -34 - layer * 24,
    );
    group.add(mesh);
    meshes.push(mesh);
  }
  // 快速横竖屏切换只提交最新请求；旧批次仍受统一取消信号控制。
  let revision = 0;
  return {
    group,
    async setQuality(mobile: boolean) {
      const request = ++revision;
      // 竖屏把主峰移入可见山谷，横屏恢复原构图；只移动背景山群，不改宝盒、地面或相机运动。
      const aspect = window.innerWidth / Math.max(1, window.visualViewport?.height ?? window.innerHeight);
      group.position.x = aspect < .6 ? 12 : aspect < 1 ? 16 : 0;
      if (mobile === lightweight) return;
      // 两档几何随场景缓存；切回已使用画质直接复用，准备期间保持整套旧山体可见。
      const prepared: THREE.BufferGeometry[] = [];
      for (let layer = 0; layer < meshes.length; layer++) {
        prepared.push(await geometryFor(layer, mobile));
        if (request !== revision) return;
      }
      init.check();
      meshes.forEach((mesh, layer) => { mesh.geometry = prepared[layer]; });
      lightweight = mobile;
    },
  };
}
