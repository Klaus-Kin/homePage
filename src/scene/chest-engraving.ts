/** 手绘繁体刻字笔画；保留不规则刻线，颜色、槽深和金色发光均由同一路径生成。 */
export const glyphs: Record<string, string[]> = {
  // 「摩訶」沿用手刻路径；訶保留完整言字旁，不能使用简体讠替代。
  "摩": ["M49 5L57 13M17 28L19 18L95 15M17 28L15 63L6 96", "M25 36L57 34M40 25L39 60M35 40L23 56M44 40L55 53", "M62 35L93 33M77 24L76 60M72 40L59 56M80 39L94 53", "M77 62L36 68M28 77L87 73M24 87L92 82M59 67L58 94L46 98"],
  "訶": ["M18 7L26 15M5 27L39 25M10 39L35 37M10 51L35 49", "M10 63L35 61L35 90L10 92Z", "M44 20L96 18M51 39L75 37L75 68L50 70ZM86 20L85 89L74 96"],
  "回": ["M13 12L88 10L87 92L12 94ZM31 33L70 31L69 73L30 75Z"],
  "到": ["M8 16L57 13M32 16L14 42L53 39M42 28L59 47", "M10 57L59 54M34 44L33 81M8 88L61 81", "M71 23L70 70M87 8L87 88L76 95"],
  "未": ["M16 29L85 26M8 52L93 48M50 7L49 95", "M45 52L28 76L8 89M55 52L72 74L94 85"],
  "來": ["M12 29L91 26M50 7L49 96", "M27 34L20 52L8 64M26 43L37 60M73 33L66 52L57 62M73 44L91 61", "M47 60L29 79L8 93M54 60L72 79L94 91"],
  "時": ["M9 23L34 21L33 79L8 82ZM10 49L33 47", "M47 25L89 23M68 8L68 42M41 45L95 42M43 59L94 56M80 45L79 90L67 95M50 69L61 80"],
  "倒": ["M24 8L15 37L5 53M17 32L16 96", "M31 22L66 20M48 23L33 45L62 42M54 32L67 49M32 61L65 59M49 47L48 82M29 91L68 83", "M76 24L75 72M90 9L89 90L79 96"],
  "流": ["M9 12L22 23M7 38L21 48M8 91L26 62", "M58 6L65 17M33 28L94 24M59 28L41 49L85 45M76 34L92 53", "M43 58L42 77L31 94M62 57L62 92M80 56L80 88L85 93L95 90L97 79"],
  "般": ["M8 84L14 25L42 24L42 88L31 94", "M20 24L25 9", "M16 45L36 44M14 65L36 63M26 32L26 80", "M53 13L79 13L79 37L91 37M54 14L54 31L45 42", "M49 51L87 51L75 72L48 94M52 56L67 77L92 92"],
  "若": ["M8 25L93 21M30 8L32 36M70 6L68 33", "M12 47L89 44M44 34L34 57L9 80", "M35 64L80 62L79 91L33 93ZM35 87L78 85"],
  "波": ["M10 13L23 24M7 40L21 49M9 90L27 62", "M37 85L42 28L89 25L83 39M65 7L64 56", "M44 53L85 51L72 75L43 95M48 58L65 79L92 93"],
  "羅": ["M17 11L86 10L84 31L16 33ZM37 13L37 30M62 12L61 30", "M27 39L16 55L35 52L15 72L37 68M27 69L26 95M13 78L7 94M36 77L42 90", "M64 36L47 60M72 39L81 49M58 49L56 94M58 53L91 51M58 67L87 65M57 80L87 78M56 94L93 92M74 53L74 92"],
  "蜜": ["M49 5L55 14M14 32L16 19L89 18L87 31", "M37 34L37 58L72 56L77 46M52 29L60 39M22 40L14 56M82 33L91 47M73 28L52 50L23 66", "M25 69L80 67L80 83L24 85ZM53 58L52 94M13 95L89 91M83 83L94 97"],
  "月": ["M19 94L27 18L77 15L78 89L64 94M28 41L69 38M26 65L70 61"],
  "光": ["M49 7L49 48M17 16L31 34M80 13L65 35M9 49L93 44", "M36 50L31 74L9 94M62 49L61 88L69 93L88 91L92 77"],
  "寶": ["M47 4L54 12M13 29L15 17L90 15L89 28", "M18 34L44 32M20 45L43 43M30 34L30 56M16 57L45 54", "M57 29L50 40L88 38M60 38L59 54L80 53L82 39M49 58L90 56M70 42L70 56", "M29 64L77 61L77 85L28 88ZM30 72L75 69M29 80L76 77M37 88L14 98M65 86L88 96"],
  "盒": ["M50 8L30 30L8 40M50 9L70 26L92 34M30 34L72 32", "M29 43L75 41L74 60L28 62ZM18 72L84 69L83 90L18 93ZM37 72L37 91M62 71L62 90M9 95L93 92"],
};

/** 七字咒文在 1536 像素木面上居中排布，保留原有字高与加粗刀槽。 */
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

/** 沿原始刀路插入轻微偏折，保留端点与交叉结构，避免把可读字形抖成锯齿。 */
export function carvedStrokes(character: string) {
  const source = glyphs[character];
  if (!source) throw new Error(`木盒刻字缺少手绘字形：${character}`);
  return source.map((stroke, strokeIndex) => {
    const tokens = stroke.match(/[MLZ]|-?\d+(?:\.\d+)?/g)!;
    let path = "", x = 0, y = 0, firstX = 0, firstY = 0, segment = 0;
    // 同一刀槽分几次进刀，短刻面沿笔画内部错落分布；固定种子保证贴图重建不闪变。
    const facets: string[] = [];
    const seed = character.codePointAt(0)! + strokeIndex * 97;
    const lineTo = (nextX: number, nextY: number) => {
      const dx = nextX - x, dy = nextY - y, length = Math.hypot(dx, dy);
      const divisions = Math.max(1, Math.ceil(length / 13));
      if (length > 10) {
        const offset = cutVariation(seed + segment * 31) * 1.5;
        const start = 0.18 + (cutVariation(seed + segment * 19) + 1) * 0.12;
        const end = Math.min(0.9, start + 0.24 + length / 500);
        facets.push(`M${x + dx * start - dy / length * offset} ${y + dy * start + dx / length * offset}`
          + `L${x + dx * end - dy / length * (offset + 0.45)} ${y + dy * end + dx / length * (offset + 0.45)}`);
      }
      for (let part = 1; part < divisions; part++) {
        const t = part / divisions;
        const deviation = cutVariation(seed + segment * 17 + part) * 0.9;
        path += `L${(x + dx * t - dy / length * deviation).toFixed(2)} ${
          (y + dy * t + dx / length * deviation).toFixed(2)}`;
      }
      path += `L${nextX} ${nextY}`;
      x = nextX; y = nextY; segment++;
    };
    for (let i = 0; i < tokens.length;) {
      const command = tokens[i++];
      if (command === "Z") { lineTo(firstX, firstY); path += "Z"; continue; }
      const nextX = Number(tokens[i++]), nextY = Number(tokens[i++]);
      if (command === "M") {
        x = firstX = nextX; y = firstY = nextY; path += `M${x} ${y}`;
      } else lineTo(nextX, nextY);
    }
    // 主槽宽度接近原来的两倍，笔画之间保留约两成刀压差，避免变成均匀描边字体。
    return { path, width: 6.4 + cutVariation(seed + 5), facets };
  });
}

/** 七秒左右才掠过一次，实际穿过字区不足一秒；-1 让光带完全离开纹理。 */
export function engravingSweep(time: number, reduced: boolean) {
  if (reduced) return -1;
  const phase = ((time % 7.2) + 7.2) % 7.2 - 1.6;
  return phase < 0 || phase > 1.25 ? -1 : -0.18 + phase / 1.25 * 1.36;
}

/** 同一组手绘笔画共享字心变换；暖金槽底、较亮槽缘与凹槽高度逐笔对齐。 */
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
      // 平头和斜接更接近刀具切口；圆角描边会把加粗后的字变成软管。
      context.lineJoin = "bevel";
      context.lineCap = "butt";
      for (const stroke of strokes) {
        const path = new Path2D(stroke.path);
        if (channel === "emission") {
          // 窄范围柔化仅沿字槽分布，黑色背景使木面不会整体自发光。
          context.shadowColor = "#ffffff";
          context.shadowBlur = 1.1;
          context.strokeStyle = "#ffffff";
          context.lineWidth = stroke.width * 0.55;
          context.stroke(path);
          continue;
        }
        // 先刻宽暗槽，再在槽底留窄金痕；木色下缘与深色上壁形成明确的阴刻方向。
        for (const layer of [
          { x: 0.65, y: 0.9, width: stroke.width + 2.7, color: "#a19678", height: "#aaaaaa" },
          { x: 0, y: 0, width: stroke.width + 2.3, color: "#29251c", height: "#555555" },
          { x: -0.4, y: -0.5, width: stroke.width + 0.7, color: "#49391f", height: "#191919" },
          { x: 0, y: 0, width: stroke.width * 0.64, color: "#b49a60", height: "#191919" },
        ]) {
          context.save(); context.translate(layer.x, layer.y);
          context.strokeStyle = channel === "height" ? layer.height : layer.color;
          context.lineWidth = layer.width; context.stroke(path); context.restore();
        }
        // 宽槽内部保留窄而深的复刀痕，颜色与高度共用路径；月光通过凹凸法线照出深浅。
        context.strokeStyle = channel === "height" ? "#303030" : "#705735";
        context.lineWidth = 0.7;
        for (const facet of stroke.facets) context.stroke(new Path2D(facet));
      }
      context.restore();
    }
  });
}
