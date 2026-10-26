type Vector = { x: number; y: number; z: number };

/** 位置、尾迹和朝向共享一个速度向量；尾端永远处于运动反方向。 */
export function meteorFrame(time: number, velocity: Vector, length = 5) {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z) || 1;
  const direction = {
    x: velocity.x / speed,
    y: velocity.y / speed,
    z: velocity.z / speed,
  };
  const head = {
    x: velocity.x * time,
    y: velocity.y * time,
    z: velocity.z * time,
  };
  return {
    head,
    tail: {
      x: head.x - direction.x * length,
      y: head.y - direction.y * length,
      z: head.z - direction.z * length,
    },
    direction,
    headWidth: 0.065,
    tailWidth: 0.001,
    headAlpha: 1,
    tailAlpha: 0,
  };
}
