import { fbm } from "./terrain-math.ts";

export type MeadowLayer = "turf" | "grass" | "long";

/** 左坡补充实例独立于原有预算与种子；花穗、野花不加密，避免改变既有点缀。 */
export const leftMeadowBudget = {
  desktop: { turf: 8000, grass: 4000, long: 800, seeds: 0, flowers: 0 },
  mobile: { turf: 6500, grass: 3250, long: 650, seeds: 0, flowers: 0 },
} as const;

/** 连片细草承托疏密不同的长叶；中频斑块控制丛生位置，低频斑块留下浅浅草径。 */
export function sampleMeadowBlade(random: () => number, layer: MeadowLayer) {
  const x = (random() - .5) * 32;
  // 近景分配更多叶片，远处用更矮的草和透视叠加自然融入坡面。
  const z = -8 + Math.pow(random(), .72) * 26;
  return sampleBladeAt(random, layer, x, z, false);
}

/** 横向相机能看见竖屏分布之外的左坡；以独立随机源补齐，并在交接处自然变稀。 */
export function sampleLeftMeadowBlade(random: () => number, layer: MeadowLayer, mobile: boolean) {
  const right = mobile ? -5.2 : -12.5;
  const x = -22 + random() * (right + 22), z = -4 + random() * 16;
  if (random() > Math.min(1, (right - x) / 1.4)) return;
  return sampleBladeAt(random, layer, x, z, true);
}

/** 补草复用原有噪声、丛生、叶形比例和色彩分布；原分布调用顺序保持不变。 */
function sampleBladeAt(random: () => number, layer: MeadowLayer, x: number, z: number, left: boolean) {
  const field = fbm(x * .31 + 12, z * .31 + 7);
  // 只有长叶密度使用聚簇噪声；细草和短草跳过无用的四层噪声，随机数序列保持不变。
  const clump = layer === "long" ? fbm(x * 1.75 + 19, z * 1.75 + 3) : 0;
  const density = layer === "turf" ? .8 + field * .2
    : layer === "grass" ? .2 + field * .8
    : Math.max(.01, (clump - .47) * 4.8) * (.4 + field);
  if (random() > density) return;
  // 坡顶以短草为主，长叶集中在近景；高度随距离连续变化，避免远处也竖起一整堵草墙。
  const distance = Math.max(0, Math.min(1, (z + 1) / 11));
  // 左坡地势低但属于近景，保留叶片高度，避免按纵深缩成难以辨认的远景细线。
  const perspective = left ? .7 + .3 * distance : .38 + .62 * distance;
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
