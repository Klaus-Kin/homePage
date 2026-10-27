import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderStaticHtml } from "../src/static-html.ts";
import { renderSealTitleLine } from "../src/title.ts";
import { pageConfig } from "../src/config.ts";
import { glyphs } from "../src/scene/seal-glyphs.ts";
import { titleGlyphs } from "../src/title-glyphs.ts";

// 标题必须在脚本执行前就包含完整小篆，且保留原正文供辅助技术读取。
test("static heading contains both seal lines and original accessible wording", () => {
  const html = renderStaticHtml(readFileSync(new URL("../index.html", import.meta.url), "utf8"), "/blog");
  assert.equal((html.match(/class="seal-title"/g) ?? []).length, 2);
  for (const text of pageConfig.titleLines) assert.ok(html.includes(`<span class="sr-only">${text}</span>`));
  assert.ok(!html.includes("__MOON_TITLE_"));
  assert.ok(html.includes(`<path d="${glyphs["光"][0]}"`));
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
