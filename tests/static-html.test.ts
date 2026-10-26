import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderStaticHtml } from "../src/static-html.ts";

// 使用实际 HTML 模板，防止将来新增入口又绕过统一配置。
test("all three static blog entries use the configured URL before scripts run", () => {
  const template = readFileSync(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const address = "https://blog.example.test/notes?from=moon&tag=night";
  const html = renderStaticHtml(template, address);
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(links.filter((link) => link !== "/").length, 3);
  assert.equal(
    links.filter((link) => link === address.replaceAll("&", "&amp;")).length,
    3,
  );
  assert.ok(!html.includes("__MOON_BLOG_URL__"));
  assert.ok(!html.includes("https://example.com/blog"));
});

// 地址可能带引号、尖括号或替换元字符，须作为属性文本保留，而非注入新 HTML。
test("static URL attributes escape HTML and preserve replacement metacharacters", () => {
  const address =
    'https://blog.example.test/?mode=$&from="moon"&tag=<night>&quote=\'';
  assert.equal(
    renderStaticHtml('<a href="__MOON_BLOG_URL__">博客</a>', address),
    '<a href="https://blog.example.test/?mode=$&amp;from=&quot;moon&quot;&amp;tag=&lt;night&gt;&amp;quote=&#39;">博客</a>',
  );
});
