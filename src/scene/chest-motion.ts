/** 上下半盒绕左短端的水平轴上翻；旋转平面垂直地面，边界不包含光束。 */
export function chestPose(progress: number) {
  const angle = Math.max(0, Math.min(1, progress)) * Math.PI;
  const hinge = { x: 1.93, y: 0.61, z: 0 };
  const bounds = { minX: -1.93, maxX: 1.93, minY: 0, maxY: 0.61, minZ: -0.22, maxZ: 0.22 };
  // 上半盒从闭合位置抬起，右端越过铰链上方后落到左侧；纵深坐标始终不变。
  for (const x of [-1.93, 1.93]) for (const y of [0, 0.61]) {
    const px = hinge.x + (x - hinge.x) * Math.cos(angle) + y * Math.sin(angle);
    const py = hinge.y - (x - hinge.x) * Math.sin(angle) + y * Math.cos(angle);
    bounds.minX = Math.min(bounds.minX, px);
    bounds.maxX = Math.max(bounds.maxX, px);
    bounds.minY = Math.min(bounds.minY, py);
    bounds.maxY = Math.max(bounds.maxY, py);
  }
  return { angle, hinge, bounds };
}

/** 上盖右端在垂直平面内走半圆，半径包含木板厚度；首帧预留完整运动范围，开盖时不再追着边缘移动镜头。 */
export function chestMotionBounds() {
  const { hinge, bounds } = chestPose(0);
  const radius = Math.hypot(hinge.x - bounds.minX, 0.61);
  return { ...bounds, maxX: hinge.x + radius, maxY: hinge.y + radius };
}
