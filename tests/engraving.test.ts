import { test } from "node:test";
import assert from "node:assert/strict";
import { engrave, engravingPlacements, glyphs } from "../src/scene/chest-engraving.ts";

// 三处刻字的全部繁体字都必须有手绘路径，禁止悄悄回退到平台字体。
test("all three inscriptions have complete hand drawn glyphs", () => {
  for (const letter of "回到未來般若波羅蜜時光倒流") {
    assert.ok(glyphs[letter]?.length, `缺少字形：${letter}`);
    assert.ok(glyphs[letter].every((stroke) => stroke.startsWith("M")));
  }
});

// 记录真实绘制调用，确认发光与槽深逐字变换一致，且保留较暗的凹槽高度。
test("gold color, recessed height and soft emission share every glyph transform", () => {
  const original = (globalThis as any).Path2D;
  (globalThis as any).Path2D = class { path: string; constructor(path: string) { this.path = path; } };
  const context = () => {
    const transforms: unknown[] = [], strokes: any[] = [];
    const ctx: any = { transforms, strokes, save() {}, restore() {},
      translate(...args: number[]) { transforms.push(["translate", ...args]); },
      rotate(angle: number) { transforms.push(["rotate", angle]); },
      scale(...args: number[]) { transforms.push(["scale", ...args]); },
      stroke(path: any) { strokes.push({ path: path.path, color: ctx.strokeStyle,
        blur: ctx.shadowBlur, width: ctx.lineWidth }); },
    };
    return ctx;
  };
  try {
    for (const [text, transform] of [["回到未來", {}], ["般若波羅蜜", {}],
      ["時光倒流", { reverse: true, rotation: Math.PI }]] as const) {
      const color = context(), height = context(), emission = context();
      engrave(color, height, emission, text, 100, 40, 154, 190, transform);
      assert.deepEqual(color.transforms, height.transforms);
      // 颜色和高度额外包含槽缘偏移，遮罩只共用每字的基本变换。
      assert.deepEqual(emission.transforms, color.transforms.filter((item: any) =>
        !(item[0] === "translate" && item[1] === 1.8 && item[2] === 2.2)));
      assert.deepEqual(emission.strokes.map((s: any) => s.path),
        color.strokes.filter((_: any, i: number) => i % 2 === 1).map((s: any) => s.path));
      assert.ok(color.strokes.some((s: any) => s.color === "#b99143"));
      assert.ok(height.strokes.some((s: any) => s.color === "#191919"));
      assert.ok(emission.strokes.every((s: any) => s.color === "#ffffff" && s.blur === 1.4));
    }
  } finally { (globalThis as any).Path2D = original; }
});

// 反排位置与逐字旋转分开处理，使颜色和凹凸纹理使用完全相同的变换。
test("glyph transforms reverse positions without mirroring the strokes", () => {
  const placed = engravingPlacements("時光倒流", 100, 20, 100, 120, { reverse: true, rotation: Math.PI });
  assert.deepEqual(placed.map((p) => p.character), [..."時光倒流"]);
  assert.deepEqual(placed.map((p) => p.x), [510, 390, 270, 150]);
  assert.ok(placed.every((p) => p.y === 70 && p.rotation === Math.PI));
  assert.deepEqual(engravingPlacements("回到", 0, 0, 100, 120).map((p) => p.x), [50, 170]);
});
