import * as THREE from "three";
import type { Initialization } from "./initialization";

/** 保留 PlaneGeometry 的顶点、UV 和三角形顺序，改用预分配数组并按行让出任务。 */
export async function createPlane(width: number, height: number, columns: number, rows: number,
  init: Initialization) {
  const geometry = init.track(new THREE.BufferGeometry());
  const count = (columns + 1) * (rows + 1);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3),
    uvs = new Float32Array(count * 2);
  const indices = count > 65535 ? new Uint32Array(columns * rows * 6) : new Uint16Array(columns * rows * 6);
  for (let y = 0; y <= rows; y++) {
    const pause = init.checkpoint(); if (pause) await pause;
    for (let x = 0; x <= columns; x++) {
      const i = y * (columns + 1) + x;
      positions[i * 3] = x * (width / columns) - width / 2;
      positions[i * 3 + 1] = -(y * (height / rows) - height / 2);
      normals[i * 3 + 2] = 1;
      uvs[i * 2] = x / columns; uvs[i * 2 + 1] = 1 - y / rows;
    }
  }
  for (let y = 0; y < rows; y++) {
    const pause = init.checkpoint(); if (pause) await pause;
    for (let x = 0; x < columns; x++) {
      const a = x + (columns + 1) * y, b = a + columns + 1, c = b + 1, d = a + 1;
      // 直接写入索引缓冲，保留三角形顺序，避免每个网格单元分配一个六元素数组。
      const offset = (y * columns + x) * 6;
      indices[offset] = a; indices[offset + 1] = b; indices[offset + 2] = d;
      indices[offset + 3] = b; indices[offset + 4] = c; indices[offset + 5] = d;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

/** 与 Three.js 面积加权法线使用相同累加顺序和 Float32 舍入，逐段计算不改变山体光照。 */
export async function computeNormals(geometry: THREE.BufferGeometry, init: Initialization) {
  const positions = geometry.attributes.position, index = geometry.index!;
  const normal = geometry.attributes.normal;
  (normal.array as Float32Array).fill(0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(),
    cb = new THREE.Vector3(), ab = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    if (i % 192 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
    a.fromBufferAttribute(positions, ia); b.fromBufferAttribute(positions, ib); c.fromBufferAttribute(positions, ic);
    cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab);
    for (const vertex of [ia, ib, ic]) {
      n.fromBufferAttribute(normal, vertex).add(cb);
      normal.setXYZ(vertex, n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < normal.count; i++) {
    if (i % 64 === 0) { const pause = init.checkpoint(); if (pause) await pause; }
    n.fromBufferAttribute(normal, i).normalize(); normal.setXYZ(i, n.x, n.y, n.z);
  }
  normal.needsUpdate = true;
}
