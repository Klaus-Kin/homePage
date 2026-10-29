import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INSCRIPTION_TEXT, scheduleStrokes, strokeProgress } from "../src/inscription-strokes.ts";
import { renderStaticHtml } from "../src/static-html.ts";

// 真实资源与调度共同验证：精确保留英文逗号，每笔都有独立轮廓、轨迹和局部遮罩。
test("the inline phrase has independent stroke shapes and masks with no runtime font", () => {
  const asset = readFileSync(new URL("../src/assets/inscription.svg", import.meta.url), "utf8");
  const letters = [...asset.matchAll(/data-character="([^"]+)"/g)].map(match => match[1]);
  assert.equal(letters.join(""), INSCRIPTION_TEXT);
  const pens = [...asset.matchAll(/data-pen="\d+" data-length="([^"]+)"/g)];
  assert.ok(pens.length >= 40);
  assert.equal((asset.match(/<mask /g) ?? []).length, pens.length);
  assert.equal((asset.match(/id="ink-\d+-\d+-outline-\d+"/g) ?? []).length, pens.length);
  assert.ok(pens.every(pen => Number(pen[1]) > 0));
  assert.ok(!/<text\b|@font-face|<image\b/.test(asset));
  const html = renderStaticHtml('<div>__MOON_INSCRIPTION__</div>', '/blog', asset);
  assert.ok(html.includes('id="inscription" aria-hidden="true"'));
  assert.ok(!html.includes('__MOON_INSCRIPTION__'));
});

test("writing length controls duration and the comma pause is included in exactly three seconds", () => {
  const strokes = [
    { length: 40, character: 0, comma: false },
    { length: 80, character: 0, comma: false },
    { length: 20, character: 1, comma: true },
    { length: 90, character: 2, comma: false },
  ];
  const timing = scheduleStrokes(strokes, 3000);
  assert.equal(timing[0].start, 0);
  assert.equal(timing[3].end, 3000);
  assert.ok(Math.abs((timing[1].end - timing[1].start) / timing[0].end - 2) < 1e-10);
  assert.ok(Math.abs(timing[1].start - timing[0].end - 6) < 1e-10);
  assert.ok(Math.abs(timing[2].start - timing[1].end - 28) < 1e-10);
  assert.ok(Math.abs(timing[3].start - timing[2].end - 120) < 1e-10);
  assert.equal(strokeProgress(-1, timing[0]), 0);
  assert.equal(strokeProgress(timing[2].start - 1, timing[2]), 0);
  assert.ok(Math.abs(strokeProgress((timing[2].start + timing[2].end) / 2, timing[2]) - 0.5) < 1e-10);
  assert.equal(strokeProgress(3000, timing[3]), 1);
});
