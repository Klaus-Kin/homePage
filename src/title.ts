import { glyphs } from "./scene/seal-glyphs.ts";
import { titleGlyphs } from "./title-glyphs.ts";

// 简体正文沿用宝盒的同源小篆字形；共用已有輪廓，不重复保存同字路径。
const aliases: Record<string, string> = { "时": "時", "来": "來", "宝": "寶" };
const keyFor = (letter: string) => aliases[letter] ?? letter;
const pathsFor = (letter: string) => titleGlyphs[keyFor(letter)] ?? glyphs[keyFor(letter)];
const idFor = (letter: string) => `seal-${keyFor(letter).codePointAt(0)!.toString(16)}`;
const escapeText = (text: string) => text.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** 整页只输出一次字形定义；标题、正文、入口和加载语全部通过 use 引用。 */
export function renderSealGlyphDefinitions(lines: readonly string[]): string {
  const letters = new Set([...lines.join("")].filter(letter => pathsFor(letter)).map(keyFor));
  return `<svg class="seal-glyph-bank" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;overflow:hidden"><defs>${[...letters].map(letter =>
    `<symbol id="${idFor(letter)}" viewBox="0 0 100 100">${pathsFor(letter).map(path => `<path d="${path}"/>`).join("")}</symbol>`).join("")}</defs></svg>`;
}

/** 只替换汉字；标点、空格直接保留文本节点，正文可自然换行且辅助技术仍读取完整原文。 */
export function renderSealCopy(text: string): string {
  return [...text].map(letter => {
    if (!/\p{Script=Han}/u.test(letter)) return escapeText(letter);
    if (!pathsFor(letter)) throw new Error(`页面文案缺少同源小篆字形：${letter}`);
    return `<span class="seal-character"><span class="sr-only">${letter}</span><svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true" focusable="false"><use href="#${idFor(letter)}"/></svg></span>`;
  }).join("");
}

/** 构建时生成同源小篆，保留可访问的正文；无脚本时也不会退回系统字体。 */
export function renderSealTitleLine(text: string): string {
  const escaped = escapeText(text);
  const letters = [...text];
  // 未收录的后续文案保留普通文字，禁止静默丢字或把文本解释为 SVG。
  if (letters.some((letter) => !pathsFor(letter))) return escaped;
  const width = letters.length * 108.5 - 8.5;
  const paths = letters.map((letter, index) =>
    `<use href="#${idFor(letter)}" x="${index * 108.5}" y="0" width="100" height="100"/>`).join("");
  return `<span class="sr-only">${escaped}</span><svg class="seal-title" aria-hidden="true" focusable="false" fill="currentColor" viewBox="0 0 ${width} 100" width="${width / 100}em" height="1em">${paths}</svg>`;
}
