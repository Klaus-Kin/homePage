/** 连续多频运动不取模，避免云片回到起点时跳变；近月层与山谷层保持不同速度。 */
export function cloudMotion(time: number, index: number, reduced: boolean) {
  const moon = index < 6, phase = index * 0.73;
  const t = reduced ? 0 : time;
  return {
    x: (Math.sin(t * (moon ? 0.12 : 0.085) + phase) - Math.sin(phase)) * (moon ? 2.2 : 5),
    y: (Math.sin(t * 0.075 + phase * 1.3) - Math.sin(phase * 1.3)) * (moon ? 0.16 : 0.3),
    scale: 1 + Math.sin(t * 0.09 + phase) * (moon ? 0.035 : 0.055),
    opacity: (moon ? 0.59 : 0.27) + Math.sin(t * 0.16 + phase) * (moon ? 0.075 : 0.045),
  };
}
