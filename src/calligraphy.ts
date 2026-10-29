import { calligraphyGlyphs } from "./calligraphy-glyphs.ts";

// 字形仅由离线工具生成；标识按码点稳定命名，重复汉字通过同一个 symbol 引用。
const idFor = (character: string) => `calligraphy-${character.codePointAt(0)!.toString(16)}`;
const escapeText = (text: string) => text.replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** 全页静态行书只定义一次轮廓；加载页、介绍和入口的颜色均从各自父元素继承。 */
export function renderCalligraphyGlyphDefinitions(lines: readonly string[]): string {
  const characters = new Set(lines.join(""));
  const symbols = [...characters].map(character => {
    const glyph = calligraphyGlyphs[character];
    if (!glyph) throw new Error(`页面静态行书缺少字形：${character}；请重新运行 scripts/build-inscription.py --copy-only`);
    // 保留行书起收锋越过字框的自然轮廓，避免 symbol 默认裁切细笔画。
    return `<symbol id="${idFor(character)}" viewBox="0 0 ${glyph.width} 100" overflow="visible"><path d="${glyph.path}" fill-rule="evenodd"/></symbol>`;
  }).join("");
  return `<svg class="calligraphy-glyph-bank" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;overflow:hidden"><defs>${symbols}</defs></svg>`;
}

/** 每行保留一份可访问原文；完整行框维持现有换行、字号与行距，不触碰链接的交互结构。 */
export function renderCalligraphyCopy(text: string, loading = false): string {
  const characters = [...text], spacing = loading ? 18 : 16;
  let x = 0;
  const uses = characters.map(character => {
    const glyph = calligraphyGlyphs[character];
    if (!glyph) throw new Error(`页面静态行书缺少字形：${character}；请重新运行 scripts/build-inscription.py --copy-only`);
    const use = `<use data-calligraphy-character="${escapeText(character)}" href="#${idFor(character)}" x="${x}" width="${glyph.width}" height="100"/>`;
    x += glyph.width + spacing;
    return use;
  }).join("");
  const width = Math.max(1, x - spacing);
  // 为同一份可访问原文提供独立钩子：强制颜色模式可恢复原生文字及对比底板，不会展开其他 sr-only 内容。
  return `<span class="sr-only calligraphy-text">${escapeText(text)}</span><svg class="${loading ? "loading-calligraphy" : "calligraphy-copy"}" viewBox="0 0 ${width} 100" width="${width / 100}em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">${uses}</svg>`;
}
