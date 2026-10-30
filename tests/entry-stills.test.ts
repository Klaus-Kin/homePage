import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 直接核对交付的 PNG 和 HTML，避免导出脚本存在但页面仍然显示另一套手绘图。
test("entry fallbacks use transparent first-frame PNGs at each layout and pixel density", () => {
  const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
  for(const kind of ["crown","monkey","monkey-active"]) for(const size of [30,36,44]) for(const ratio of [1,2]) {
    const name=`entry-${kind}-${size}${ratio===2?"@2x":""}.png`;
    assert.ok(html.includes(`/assets/${name}`),`入口未引用 ${name}`);
    const png=readFileSync(new URL(`../public/assets/${name}`,import.meta.url));
    assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    const pixels=Math.floor(size*1.6*ratio);
    assert.equal(png.readUInt32BE(16),pixels,`${name} 的画布宽度必须匹配实际 WebGL 缓冲`);
    assert.equal(png.readUInt32BE(20),pixels);
    assert.equal(png[25],6,`${name} 必须保留透明通道`);
  }
  assert.ok(!html.includes('src="/assets/phoenix-crown.svg"'),"正常后备不再使用独立手绘冠");
  assert.ok(!html.includes('<svg class="monkey-face'),"正常后备不再使用独立手绘猴头");
});
