import { glyphs } from "./scene/seal-glyphs.ts";
import { titleGlyphs } from "./title-glyphs.ts";

/** 构建时生成同源小篆，保留可访问的正文；无脚本时也不会退回系统字体。 */
export function renderSealTitleLine(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const letters = [...text];
  // 未收录的后续文案保留普通文字，禁止静默丢字或把文本解释为 SVG。
  if (letters.some((letter) => !(titleGlyphs[letter] ?? glyphs[letter]))) return escaped;
  const width = letters.length * 108.5 - 8.5;
  const paths = letters.map((letter, index) =>
    `<g transform="translate(${index * 108.5} 0)">${(titleGlyphs[letter] ?? glyphs[letter]).map((path) => `<path d="${path}"/>`).join("")}</g>`).join("");
  return `<span class="sr-only">${escaped}</span><svg class="seal-title" aria-hidden="true" focusable="false" fill="currentColor" viewBox="0 0 ${width} 100" width="${width / 100}em" height="1em">${paths}</svg>`;
}
