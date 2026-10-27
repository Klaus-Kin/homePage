/** 内部光只随开盖渐亮；减少动态使用过渡亮度驱动，待机时所有通道严格为零。 */
export function chestLightFrame(lidProgress: number, glowProgress: number, reduced: boolean) {
  const glow = Math.max(0, Math.min(1, glowProgress));
  const opening = Math.max(0, Math.min(1, reduced ? glow : lidProgress));
  const reveal = opening * opening * (3 - 2 * opening);
  return {
    intensity: (0.35 + glow * 7) * reveal,
    innerEmission: 0.018 * reveal,
    glowOpacity: (0.22 + glow * 0.78) * reveal,
    mouthOpacity: (0.3 + glow * 0.65) * reveal,
    beamStrength: glow * 0.22 * reveal,
  };
}
