/** 木盒字槽着色器与照地光共用同一光带宽度和增益，避免两个动画各自计时。 */
export const engravingGlint = { inner: 0.015, outer: 0.085, gain: 3.8 } as const;
type MaskSample = { u: number; v: number; weight: number };

/** 初始化时采样真实发光遮罩；逐帧只遍历少量有效字槽，不读回画布或重新生成贴图。 */
export function engravingReflectionProfile(pixels: ArrayLike<number>, width: number, height: number, stride = 8) {
  const samples: MaskSample[] = [];
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    const weight = pixels[(y * width + x) * 4] / 255;
    if (weight > 0) samples.push({ u: (x + .5) / width, v: 1 - (y + .5) / height, weight });
  }
  return samples;
}

/** 用同一 UV 光带计算被照亮字槽的能量与重心，再映射回盒体局部坐标。 */
export function engravingReflectionFrame(sweep: number, profile: readonly MaskSample[]) {
  if (sweep < 0 || sweep > 1 || !profile.length) return { intensity: 0, x: 0 };
  let energy = 0, center = 0;
  for (const sample of profile) {
    const distance = Math.abs(sample.u + (sample.v - .5) * .12 - sweep);
    const t = Math.max(0, Math.min(1, (distance - engravingGlint.inner) / (engravingGlint.outer - engravingGlint.inner)));
    const light = (1 - t * t * (3 - 2 * t)) * sample.weight;
    energy += light; center += sample.u * light;
  }
  return { intensity: energy / profile.length * engravingGlint.gain * .65,
    x: energy > 0 ? (.5 - center / energy) * 3.86 : 0 };
}
