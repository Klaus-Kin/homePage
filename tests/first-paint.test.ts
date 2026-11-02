import { test } from "node:test";
import assert from "node:assert/strict";
import { inlinePageStyles } from "../src/first-paint.ts";

// 验证真实构建标签保留样式顺序，同时不破坏图标、预加载和正文。
test("page CSS paints without a second network request and preserves cascade order", () => {
  const html = '<style>critical</style><link rel="icon" href="/icon.svg"><link rel="stylesheet" crossorigin href="/assets/page.css"><link rel="modulepreload" href="/assets/scene.js"><body>scene</body>';
  assert.equal(inlinePageStyles(html, new Map([["/assets/page.css", "body{background:#080f20}"]])),
    '<style>critical</style><link rel="icon" href="/icon.svg"><style data-page-styles>body{background:#080f20}</style><link rel="modulepreload" href="/assets/scene.js"><body>scene</body>');
});

// CSS 中意外出现 HTML 结束标记也不能提前闭合内联样式。
test("missing CSS fails the build and style text cannot close its HTML element", () => {
  assert.throws(() => inlinePageStyles('<link rel="stylesheet" href="/missing.css">', new Map()), /首屏样式未找到/);
  assert.equal(inlinePageStyles('<link rel="stylesheet" href="/page.css">', new Map([["/page.css", 'a{content:"</style>"}']])),
    '<style data-page-styles>a{content:"<\\/style>"}</style>');
});
