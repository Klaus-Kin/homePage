import { glyphs } from "./seal-glyphs.ts";
export { glyphs } from "./seal-glyphs.ts";

/** 七字咒文在 1536 像素木面上居中排布，保留原有字高与小篆轮廓内的留白。 */
export const spellEngraving = { text: "摩訶般若波羅蜜", x: 150, y: 46, size: 156, spacing: 180 } as const;

/** 字序与每字角度独立控制；围绕字心旋转不会镜像笔画或改变槽深。 */
type GlyphTransform = { reverse?: boolean; rotation?: number };
/** 字码与笔画序号生成固定偏差；贴图重建和三个通道绝不能各自抽随机数。 */
function cutVariation(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

export function engravingPlacements(text: string, x: number, y: number, size: number,
  spacing: number, transform: GlyphTransform = {}) {
  return [...text].map((character, index, letters) => {
    const seed = character.codePointAt(0)! + index * 13;
    return { character,
      x: x + (transform.reverse ? letters.length - 1 - index : index) * spacing + size / 2
        + cutVariation(seed) * size * 0.012,
      y: y + size / 2 + cutVariation(seed + 2) * size * 0.026,
      rotation: (transform.rotation ?? 0) + cutVariation(seed + 4) * 0.03 };
  });
}

/** 直接保留字库的封闭曲线；只有刀槽边缘有轻微宽差，不能用直线重采样破坏小篆字形。 */
export function carvedStrokes(character: string) {
  const source = glyphs[character];
  if (!source) throw new Error(`木盒刻字缺少小篆字形：${character}`);
  return source.map((path, index) => ({ path,
    width: 0.8 + cutVariation(character.codePointAt(0)! + index * 97) * 0.12 }));
}

/** 七秒左右才掠过一次，实际穿过字区不足一秒；-1 让光带完全离开纹理。 */
export function engravingSweep(time: number, reduced: boolean) {
  if (reduced) return -1;
  const phase = ((time % 7.2) + 7.2) % 7.2 - 1.6;
  return phase < 0 || phase > 1.25 ? -1 : -0.18 + phase / 1.25 * 1.36;
}

/** 同一组小篆轮廓共享字心变换；暖金槽底、较亮槽缘与凹槽高度逐字对齐。 */
export function engrave(color: CanvasRenderingContext2D, height: CanvasRenderingContext2D,
  emission: CanvasRenderingContext2D,
  text: string, x: number, y: number, size: number, spacing: number, transform: GlyphTransform = {}) {
  engravingPlacements(text, x, y, size, spacing, transform).forEach((placement) => {
    const { character } = placement;
    const strokes = carvedStrokes(character);
    for (const [context, channel] of [[color, "color"], [height, "height"], [emission, "emission"]] as const) {
      context.save();
      context.translate(placement.x, placement.y);
      context.rotate(placement.rotation);
      context.scale(size / 100, size / 100);
      context.translate(-50, -50);
      // 字库已包含完整笔画厚度；填充实体轮廓，只给细小刀缘圆接，保留篆书的弧线和留白。
      context.lineJoin = "round";
      context.lineCap = "round";
      for (const stroke of strokes) {
        const path = new Path2D(stroke.path);
        if (channel === "emission") {
          // 窄范围柔化仅沿字槽分布，黑色背景使木面不会整体自发光。
          context.shadowColor = "#ffffff";
          context.shadowBlur = 1.1;
          context.fillStyle = "#ffffff";
          context.strokeStyle = "#ffffff";
          context.lineWidth = stroke.width * 0.25;
          context.fill(path);
          context.stroke(path);
          continue;
        }
        // 先刻宽暗槽，再在槽底留窄金痕；木色下缘与深色上壁形成明确的阴刻方向。
        for (const layer of [
          { x: 0.55, y: 0.7, width: stroke.width + 1.3, color: "#a19678", height: "#aaaaaa" },
          { x: 0, y: 0, width: stroke.width + 1.0, color: "#29251c", height: "#555555" },
          { x: -0.25, y: -0.35, width: stroke.width * 0.5, color: "#49391f", height: "#191919" },
          { x: 0, y: 0, width: stroke.width * 0.2, color: "#b49a60", height: "#191919" },
        ]) {
          context.save(); context.translate(layer.x, layer.y);
          context.strokeStyle = channel === "height" ? layer.height : layer.color;
          context.fillStyle = context.strokeStyle;
          context.lineWidth = layer.width; context.fill(path); context.stroke(path); context.restore();
        }
      }
      context.restore();
    }
  });
}
