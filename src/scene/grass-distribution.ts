import { fbm } from "./terrain-math.ts";

/** 每簇共用色调与根部；叶片保留独立的高度和朝向，避免复制相同的草模型。 */
type GrassBlade = { x: number; z: number; size: number; yaw: number; lean: number };
type GrassTuft = { x: number; z: number; hue: number; lightness: number; blades: GrassBlade[] };

/** 先决定草丛所在的斑块，再从紧凑根部生成放射状叶片；未选中的区域直接留作裸地。 */
export function sampleGrassTuft(random: () => number): GrassTuft | undefined {
  const x = (random() - 0.5) * 24, z = random() * 18 - 5;
  // 低频密度留下零散空地；不再横穿草坡挖出整条禁生带，也不把草平移到边缘堆积。
  const coverage = fbm(x * 0.23 + 3, z * 0.23 + 8);
  if (coverage < 0.43 ||
    random() > Math.min(0.95, (coverage - 0.43) * 3.5 + 0.15)) return;

  const size = (0.56 + random() * 0.3) * (z < -3 ? 0.7 : 1);
  const count = 12 + Math.floor(random() * 7), rotation = random() * Math.PI * 2;
  const blades: GrassBlade[] = [];
  for (let i = 0; i < count; i++) {
    // 黄金角打散叶片方向；中部叶片高而直立，外围叶片短且外倾，形成一簇完整轮廓。
    const spread = i / (count - 1), yaw = rotation + i * 2.399963 + random() * 0.35;
    const radius = 0.015 + random() * 0.04;
    blades.push({
      x: x - Math.cos(yaw) * radius,
      z: z + Math.sin(yaw) * radius,
      size: size * (1.12 - spread * 0.52) * (0.9 + random() * 0.2),
      yaw,
      lean: 0.08 + spread * 0.58 + random() * 0.08,
    });
  }
  return { x, z, hue: 0.22 + random() * 0.035, lightness: 0.33 + random() * 0.07, blades };
}

/** 响应式切换只截断完整草簇，避免把最后一簇切成零散叶片；实例仍在同一次绘制中。 */
export function grassCountForBudget(tuftEnds: readonly number[], budget: number) {
  let count = 0;
  for (const end of tuftEnds) {
    if (end > budget) break;
    count = end;
  }
  return count;
}
