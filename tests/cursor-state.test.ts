import { test } from "node:test";
import assert from "node:assert/strict";
import { cursorKindForTarget, CURSOR_STYLES } from "../src/cursor-state.ts";
import { readFileSync } from "node:fs";

// 用命中对象验证优先级与移出归位；运行时再用真实文字和图标检查 closest 的覆盖范围。
test("cursor selects the entry hand, chest grip and global staff", () => {
  assert.equal(cursorKindForTarget(null), "staff");
  assert.equal(cursorKindForTarget({ closest: () => null }), "staff");
  assert.equal(cursorKindForTarget({ closest: selector => selector.includes("journey-link") }), "point");
  assert.equal(cursorKindForTarget({ closest: selector => selector.includes("box-button") }), "grab");
  for (const style of Object.values(CURSOR_STYLES)) {
    const png = readFileSync(new URL(`../public${style.source}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), 144);
    assert.equal(png.readUInt32BE(20), 144);
    assert.equal(png[25], 6, "鼠标资源必须保持透明背景");
    assert.ok(style.x >= 0 && style.x < 72 && style.y >= 0 && style.y < 72);
  }
});
