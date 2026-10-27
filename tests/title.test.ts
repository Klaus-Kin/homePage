import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderStaticHtml } from "../src/static-html.ts";
import { renderSealTitleLine, renderSealCopy, renderSealGlyphDefinitions } from "../src/title.ts";
import { pageConfig } from "../src/config.ts";
import { glyphs } from "../src/scene/seal-glyphs.ts";
import { titleGlyphs } from "../src/title-glyphs.ts";

// 标题必须在脚本执行前就包含完整小篆，且保留原正文供辅助技术读取。
test("static heading contains both seal lines and original accessible wording", () => {
  const html = renderStaticHtml(readFileSync(new URL("../index.html", import.meta.url), "utf8"), "/blog");
  assert.equal((html.match(/class="seal-title"/g) ?? []).length, 2);
  for (const text of pageConfig.titleLines) assert.ok(html.includes(`<span class="sr-only">${text}</span>`));
  assert.ok(!html.includes("__MOON_TITLE_"));
  assert.equal(html.split(`<path d="${glyphs["光"][0]}"`).length - 1, 1);
});

// 所有指定汉字复用同一个字形表；标点与空格保持普通文本，不换形、不改码点。
test("all requested copy uses shared seal glyphs while punctuation stays unchanged", () => {
  const lines = [...pageConfig.description, "循着月光，走进我的世界", "月色正好，欢迎来访"];
  const bank = renderSealGlyphDefinitions([...pageConfig.titleLines, ...lines]);
  for (const line of lines) {
    const html = renderSealCopy(line);
    for (const letter of line) if (/\p{Script=Han}/u.test(letter)) {
      assert.ok(html.includes(`<span class="sr-only">${letter}</span>`), `缺少汉字 ${letter}`);
      assert.ok(html.includes('<use href="#seal-'));
    }
    assert.equal(html.replace(/<[^>]+>/g, ""), line);
  }
  const ids = [...bank.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(renderSealTitleLine("月光宝盒").includes('<use href="#seal-'));
});

// 配置扩展时仍能显示未收录字，并把特殊字符作为文本处理。
test("unknown heading glyphs fall back to escaped text", () => {
  assert.equal(renderSealTitleLine('<新&"'), "&lt;新&amp;&quot;");
});

// 轮廓提取必须正确处理源字体中的科学计数坐标，避免月字出现越界尖角和损坏命令。
test("title outlines remain inside their normalized glyph cells", () => {
  for (const [letter, paths] of Object.entries(titleGlyphs)) for (const path of paths) {
    assert.ok(!/[Ee]/.test(path), `${letter}: 数值转换后不应残留指数`);
    for (const number of path.match(/-?\d+(?:\.\d+)?/g) ?? [])
      assert.ok(+number >= 0 && +number <= 100, `${letter}: 越界坐标 ${number}`);
  }
});
