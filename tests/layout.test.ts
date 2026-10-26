import { test } from "node:test";
import assert from "node:assert/strict";
import { selectSceneLayout } from "../src/config.ts";

// 覆盖审查中复现的大屏竖屏、近方形屏幕，以及旋转后恢复桌面布局的边界。
test("large portrait and near-square viewports keep the centered camera", () => {
  for (const [width, height] of [
    [1024, 1366],
    [1280, 1600],
    [1440, 1920],
    [1024, 1024],
    [1280, 1024],
  ]) {
    assert.equal(
      selectSceneLayout(width, height),
      "tablet",
      `${width}x${height}`,
    );
  }
  assert.equal(selectSceneLayout(1366, 1024), "desktop");
  assert.equal(selectSceneLayout(1024, 768), "desktop");
});

// 保留原有手机、横屏手机与窄平板的构图规则，画质策略仍由输入设备独立决定。
test("existing mobile, short-screen and narrow-tablet compositions remain available", () => {
  assert.equal(selectSceneLayout(390, 844), "mobile");
  assert.equal(selectSceneLayout(844, 390), "short");
  assert.equal(selectSceneLayout(768, 1024), "tablet");
  assert.equal(selectSceneLayout(1023, 768), "tablet");
  assert.equal(selectSceneLayout(1920, 1080), "desktop");
});
