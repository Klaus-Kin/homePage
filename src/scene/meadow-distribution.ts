import { fbm } from "./terrain-math.ts";

export type MeadowLayer = "turf" | "grass" | "long";

/** 连片细草承托疏密不同的长叶；中频斑块控制丛生位置，低频斑块留下浅浅草径。 */
export function sampleMeadowBlade(random: () => number, layer: MeadowLayer) {
  let x = (random() - .5) * 32;
  // 近景分配更多叶片，远处用更矮的草和透视叠加自然融入坡面。
  let z = -8 + Math.pow(random(), .72) * 26;
  const field = fbm(x * .31 + 12, z * .31 + 7);
  const clump = fbm(x * 1.75 + 19, z * 1.75 + 3);
  const density = layer === "turf" ? .8 + field * .2
    : layer === "grass" ? .2 + field * .8
    : Math.max(.01, (clump - .47) * 4.8) * (.4 + field);
  if (random() > density) return;
  // 坡顶以短草为主，长叶集中在近景；高度随距离连续变化，避免远处也竖起一整堵草墙。
  const perspective = .38 + .62 * Math.max(0, Math.min(1, (z + 1) / 11));
  const height = (layer === "turf" ? .09 + random() * .19
    : layer === "grass" ? .24 + random() * .3
    : .52 + random() * .48) * perspective;
  if (layer === "long") {
    // 每片长叶向不同的错位草根聚拢，形成散落的蓬松簇；中心用噪声扰动，打破方格排列。
    const cx = Math.floor(x / 1.35), cz = Math.floor(z / 1.35);
    x = cx * 1.35 + .2 + fbm(cx + 31, cz + 19) * .95 + (random() - .5) * .55;
    z = cz * 1.35 + .2 + fbm(cx + 12, cz + 37) * .95 + (random() - .5) * .55;
  }
  // 一部分叶片顺着同一风向，仍保留独立朝向和外倾，避免整片草呈梳子状排列。
  const yaw = random() * Math.PI * 2;
  const lean = (random() - .38) * (layer === "long" ? .85 : .55);
  return { x, z, height, width: .48 + random() * .65, yaw, lean,
    hue: .235 + field * .055 + (random() - .5) * .035,
    lightness: .16 + field * .09 + random() * .055 };
}
