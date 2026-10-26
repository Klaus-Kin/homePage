import * as THREE from "three";
import { fbm, mountainHeight } from "./terrain-math";
import { surfaceTexture } from "./textures";

/** 远山单独维护几何细节等级，手机减少顶点但保留相同山脊、材质和光照。 */
export function createMountains() {
  const group = new THREE.Group();
  let lightweight =
    window.innerWidth < 768 ||
    window.innerHeight < 500 ||
    matchMedia("(pointer: coarse)").matches;
  const rock = surfaceTexture("rock");
  rock.repeat.set(45, 9);

  function geometryFor(layer: number, mobile: boolean) {
    const columns = mobile ? (layer < 2 ? 170 : 110) : layer < 2 ? 420 : 270;
    const rows = mobile ? 36 : 76;
    const geometry = new THREE.PlaneGeometry(280, 52, columns, rows);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++)
      positions.setY(
        i,
        mountainHeight(positions.getX(i), positions.getZ(i), layer),
      );
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal;
    const colors = new Float32Array(positions.count * 3),
      color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
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
        0.29 + cliff * 0.13 + grain * 0.13 + strata,
      );
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  const meshes = Array.from({ length: 5 }, (_, layer) => {
    const material = new THREE.MeshStandardMaterial({
      map: rock,
      bumpMap: rock,
      bumpScale: layer < 2 ? 0.75 : 0.4,
      vertexColors: true,
      roughness: 1,
    });
    const mesh = new THREE.Mesh(geometryFor(layer, lightweight), material);
    mesh.position.set(
      layer % 2 ? -12 : 10,
      -2 - layer * 0.35,
      -34 - layer * 24,
    );
    group.add(mesh);
    return mesh;
  });
  return {
    group,
    setQuality(mobile: boolean) {
      if (mobile === lightweight) return;
      lightweight = mobile;
      // 只在桌面与轻量模式互换时重建；旧几何立即释放，普通 resize 不重复分配。
      meshes.forEach((mesh, layer) => {
        const old = mesh.geometry;
        mesh.geometry = geometryFor(layer, mobile);
        old.dispose();
      });
    },
  };
}
