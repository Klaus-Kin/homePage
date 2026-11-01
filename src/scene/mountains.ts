import * as THREE from "three";
import type { Initialization } from "./initialization";
import { ownTree } from "./resources";
import { createPlane, computeNormals } from "./geometry";
import { fbm, mountainHeight } from "./terrain-math";
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

  async function geometryFor(layer: number, mobile: boolean) {
    init.phase = `mountain-${layer}`;
    const columns = mobile ? (layer < 2 ? 170 : 110) : layer < 2 ? 420 : 270;
    // 近层包含独立支峰，纵向细分只增加在这一层；移动端仍有独立的顶点上限。
    const rows = layer === 0 ? (mobile ? 56 : 130) : mobile ? 36 : 76;
    const geometry = await createPlane(280, 52, columns, rows, init);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      if (i % 32 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
      // 把同样数量的横向顶点集中到主要可见山群，外围仍延伸至原有边界。
      const u = positions.getX(i) / 140;
      positions.setX(i, Math.sign(u) * Math.pow(Math.abs(u), 1.5) * 140);
      positions.setY(
        i,
        mountainHeight(positions.getX(i), positions.getZ(i), layer),
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
      // 竖屏把主峰移入可见山谷，横屏恢复原构图；只移动背景山群，不改宝盒、地面或相机运动。
      const aspect = window.innerWidth / Math.max(1, window.visualViewport?.height ?? window.innerHeight);
      group.position.x = aspect < .6 ? 12 : aspect < 1 ? 16 : 0;
      if (mobile === lightweight) return;
      lightweight = mobile;
      // 只在桌面与轻量模式互换时重建；旧几何立即释放，普通 resize 不重复分配。
      const request = ++revision;
      for (const [layer, mesh] of meshes.entries()) {
        const geometry = await geometryFor(layer, mobile);
        if (request !== revision) { init.release(geometry); return; }
        const old = mesh.geometry;
        mesh.geometry = geometry;
        init.release(old);
      }
    },
  };
}
