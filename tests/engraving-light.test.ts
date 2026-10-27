import { test } from "node:test";
import assert from "node:assert/strict";
import { engravingReflectionProfile, engravingReflectionFrame } from "../src/scene/engraving-light.ts";
import { engravingSweep } from "../src/scene/chest-engraving.ts";

// 使用两处分离的真实像素遮罩，光必须跟随被扫亮的字槽，不能在空白木面下持续发光。
test("ground reflection follows the illuminated engraving mask and fades outside the sweep", () => {
  const width = 128, height = 32, pixels = new Uint8ClampedArray(width * height * 4);
  for (const x of [32, 88]) for (let y = 8; y < 24; y++) pixels[(y * width + x) * 4] = 255;
  const profile = engravingReflectionProfile(pixels, width, height, 1);
  const left = engravingReflectionFrame(.25, profile), right = engravingReflectionFrame(.69, profile);
  assert.ok(left.intensity > 0 && right.intensity > 0);
  // 盒体旋转后的纹理 UV 从局部右端向左端增大，地面光也必须遵循同一个方向。
  assert.ok(left.x > right.x);
  for (const sweep of [-1, 0, .48, 1]) assert.equal(engravingReflectionFrame(sweep, profile).intensity, 0);
  assert.equal(engravingReflectionFrame(engravingSweep(2.2, true), profile).intensity, 0);
});

// 没有发光字槽的表面不能产生环境反光；低亮遮罩也应形成同比例的弱光。
test("reflection uses actual mask energy and handles empty masks", () => {
  const pixels = new Uint8ClampedArray(64 * 16 * 4);
  const empty = engravingReflectionProfile(pixels, 64, 16, 1);
  assert.equal(engravingReflectionFrame(.5, empty).intensity, 0);
  pixels[(8 * 64 + 32) * 4] = 255;
  const bright = engravingReflectionProfile(pixels, 64, 16, 1);
  pixels[(8 * 64 + 32) * 4] = 64;
  const dim = engravingReflectionProfile(pixels, 64, 16, 1);
  assert.ok(engravingReflectionFrame(.5, bright).intensity > engravingReflectionFrame(.5, dim).intensity);
});
