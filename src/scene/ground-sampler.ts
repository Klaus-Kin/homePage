import type * as THREE from "three";

/** 与地面网格共享行列和对角线，根部贴住实际三角面，避免噪声函数与网格插值产生悬浮。 */
export function createGroundSampler(geometry: THREE.BufferGeometry, columns = 180, rows = 180) {
  const p = geometry.attributes.position;
  const x0 = p.getX(0), z0 = p.getZ(0);
  const dx = (p.getX(columns) - x0) / columns;
  const dz = (p.getZ(rows * (columns + 1)) - z0) / rows;
  return (x: number, z: number) => {
    const u = Math.max(0, Math.min(columns, (x - x0) / dx));
    const v = Math.max(0, Math.min(rows, (z - z0) / dz));
    const col = Math.min(columns - 1, Math.floor(u)), row = Math.min(rows - 1, Math.floor(v));
    const fx = u - col, fz = v - row;
    const a = row * (columns + 1) + col, b = a + columns + 1, d = a + 1, c = b + 1;
    return fx + fz <= 1
      ? p.getY(a) * (1 - fx - fz) + p.getY(d) * fx + p.getY(b) * fz
      : p.getY(b) * (1 - fx) + p.getY(d) * (1 - fz) + p.getY(c) * (fx + fz - 1);
  };
}
