/** 依据参考照片可辨笔画手绘九字；保留不规则刻线，不调用系统字体或描画金色字。 */
const glyphs: Record<string, string[]> = {
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

/** 同一笔画同时写入颜色和高度纹理，暗槽配微弱磨亮的下缘，产生阴刻而非贴字。 */
export function engrave(color: CanvasRenderingContext2D, height: CanvasRenderingContext2D,
  text: string, x: number, y: number, size: number, spacing: number) {
  [...text].forEach((character, index) => {
    for (const [context, isHeight] of [[color, false], [height, true]] as const) {
      context.save();
      context.translate(x + index * spacing, y);
      context.scale(size / 100, size / 100);
      context.lineJoin = "round";
      context.lineCap = "round";
      for (const stroke of glyphs[character]) {
        const path = new Path2D(stroke);
        context.save();
        context.translate(1.8, 2.2);
        context.strokeStyle = isHeight ? "#a5a5a5" : "#8b877b";
        context.lineWidth = 2.6;
        context.stroke(path);
        context.restore();
        context.strokeStyle = isHeight ? "#191919" : "#161714";
        context.lineWidth = 2.9;
        context.stroke(path);
      }
      context.restore();
    }
  });
}
