import { chestPlacement } from "./chest-placement.ts";

/** 水平凸包保留每块岩石实际变换后的轮廓，避免统一圆形禁区把石边草全清空。 */
type Point = { x: number; z: number };

export function obstacleFootprint(vertices: ArrayLike<number>, matrix: ArrayLike<number>): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    points.push({ x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] });
  }
  points.sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const chain = (list: Point[]) => {
    const hull: Point[] = [];
    for (const p of list) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  return [...chain(points), ...chain([...points].reverse())];
}

/** 圆形草叶包络与凸包做相交检测，边角按线段距离处理，保留贴近岩边的自然植被。 */
export function overlapsFootprint(x: number, z: number, radius: number, polygon: readonly Point[]) {
  let inside = true;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    if (dx * (z - a.z) - dz * (x - a.x) < -1e-10) inside = false;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    if ((x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 <= radius * radius) return true;
  }
  return inside;
}

/** 覆盖草尖高度、实例倾角、叶身弯曲及着色器的双向最大风摆；任意朝向都安全。 */
export function grassReach(scale: number, lean: number) {
  return scale * Math.hypot(0.035 + 0.54 * Math.sin(Math.abs(lean)) + 0.54 ** 2 * 0.24, 0.08) + 0.008;
}

// 保守覆盖水平转轴的整条扫掠路径：最远端半径计入上半盒厚度，再换算到世界坐标。
const sweepRadius = Math.hypot(3.86, 0.61);
const { x: chestX, z: chestZ, scale: chestScale } = chestPlacement;
export const chestFootprint: readonly Point[] = [
  { x: chestX - chestScale * (1.93 + sweepRadius) - 0.025, z: chestZ - 0.17 },
  { x: chestX + chestScale * 1.93 + 0.025, z: chestZ - 0.17 },
  { x: chestX + chestScale * 1.93 + 0.025, z: chestZ + 0.17 },
  { x: chestX - chestScale * (1.93 + sweepRadius) - 0.025, z: chestZ + 0.17 },
];

// 主体四周额外留出近一米的圆角留白；与开盖扫掠区分别检查，避免把整条坡面清空。
const chestBodyFootprint: readonly Point[] = [
  { x: chestX - chestScale * 1.93, z: chestZ - chestScale * 0.32 },
  { x: chestX + chestScale * 1.93, z: chestZ - chestScale * 0.32 },
  { x: chestX + chestScale * 1.93, z: chestZ + chestScale * 0.32 },
  { x: chestX - chestScale * 1.93, z: chestZ + chestScale * 0.32 },
];

/** 岩石、草叶和整株花使用相同的留白规则，并计入各自的外伸半径。 */
export function overlapsChestScenery(x: number, z: number, radius: number) {
  return overlapsFootprint(x, z, radius + 0.9, chestBodyFootprint) ||
    overlapsFootprint(x, z, radius, chestFootprint);
}

/** 手机前景留空：连石头靠镜头的边缘都必须退到宝盒后方，不能只凭中心点判断。 */
export function isForegroundRock(footprint: readonly Point[]) {
  return footprint.some(point => point.z > chestPlacement.z - 0.2);
}

/** 宽屏中间已定位的三块石头位于这一小片草坡，其余石头保持原位。 */
export function isCenterMeadowRock(x: number, z: number) {
  return x > -3.5 && x < -0.6 && z > 4.2 && z < 5.9;
}
