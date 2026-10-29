const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** 固定种子只在初始化时使用，所有方向和轮廓在后续帧保持一致，避免边缘跳动。 */
export function inkGeometry() {
  let seed = 0x319a70;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const phases = Array.from({ length: 6 }, () => random() * Math.PI * 2);
  const edge = Array.from({ length: 256 }, (_, i) => {
    const angle = i / 256 * Math.PI * 2;
    return 1 + [0.19, 0.13, 0.07, 0.035, 0.012, 0.006].reduce((sum, amplitude, j) =>
      sum + amplitude * Math.sin(angle * [3, 5, 9, 17, 43, 87][j] + phases[j]), 0);
  });
  const drops = Array.from({ length: 14 }, (_, i) => ({
    angle: (i + random() * .7) / 14 * Math.PI * 2,
    distance: 1.8 + random() * 3.4, radius: .045 + random() * .09,
    duration: 130 + random() * 100, delay: random() * 10, stretch: 1 + random() * .65,
  }));
  const filaments = Array.from({ length: 6 }, (_, i) => ({
    angle: (i + random() * .6) / 6 * Math.PI * 2,
    distance: 1.5 + random() * 1.8, width: .04 + random() * .065, bend: (random() - .5) * .5,
  }));
  return { edge, drops, filaments };
}

/** 墨池先撞开再缓慢浸染；固定轮廓乘以单调半径，每个角度均不会回缩。 */
export function inkRadius(elapsed: number, coverage: number, pool: number): number {
  if (elapsed < 120) return 0;
  if (elapsed < 360) return pool * (0.15 + .85 * (1 - Math.pow(1 - clamp((elapsed - 120) / 240), 3)));
  return pool + Math.max(0, coverage - pool) * Math.pow(clamp((elapsed - 360) / 2040), 1.16);
}

/** 同时约束像素比与总像素；向下取整避免边界尺寸突破 250 万预算。 */
export function canvasSize(width: number, height: number, deviceRatio: number, buffers = 1) {
  // 双缓冲按画布数量共享预算，不将保留成功帧的内存成本隐含翻倍。
  const ratio = Math.min(1.5, deviceRatio, Math.sqrt(2500000 / Math.max(1, width * height * buffers)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)), ratio };
}
