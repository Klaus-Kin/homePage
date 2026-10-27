import { test } from "node:test";
import assert from "node:assert/strict";
import { engrave, engravingPlacements, glyphs, carvedStrokes, engravingSweep } from "../src/scene/chest-engraving.ts";

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
      // 三张贴图共用字心、角度和手刻路径；窄金线必须留在更宽的暗槽内部。
      assert.deepEqual(emission.transforms.filter((t: any) => t[0] === "rotate"),
        color.transforms.filter((t: any) => t[0] === "rotate"));
      assert.deepEqual(emission.transforms, color.transforms.filter((t: any) =>
        !(t[0] === "translate" && Math.abs(t[1]) <= 1 && Math.abs(t[2]) <= 1)));
      for (const stroke of emission.strokes) {
        assert.ok(stroke.blur > 0 && stroke.blur <= 1.5);
        assert.ok(color.strokes.some((s: any) => s.path === stroke.path && s.width > stroke.width + 2));
        assert.ok(height.strokes.some((s: any) => s.path === stroke.path && s.color === "#191919"));
      }
      assert.ok(color.strokes.some((s: any) => s.color === "#29251c"));
      assert.ok(emission.strokes.every((s: any) => s.color === "#ffffff"));
    }
  } finally { (globalThis as any).Path2D = original; }
});

// 反排位置与逐字旋转分开处理，使颜色和凹凸纹理使用完全相同的变换。
test("glyph transforms reverse positions without mirroring the strokes", () => {
  const placed = engravingPlacements("時光倒流", 100, 20, 100, 120, { reverse: true, rotation: Math.PI });
  assert.deepEqual(placed.map((p) => p.character), [..."時光倒流"]);
  const normal = engravingPlacements("時光倒流", 100, 20, 100, 120);
  placed.forEach((p, i) => {
    assert.ok(Math.abs(p.x - [510, 390, 270, 150][i]) < 2);
    assert.ok(Math.abs(p.y - 70) < 3);
    assert.ok(Math.abs(p.rotation - Math.PI) < 0.035);
    assert.ok(Math.abs(p.rotation - normal[i].rotation - Math.PI) < 1e-10);
  });
  assert.ok(new Set(normal.map((p) => p.y)).size > 1, "手刻基线应有轻微偏差");
});

// 刀痕固定种子、局部有细微偏折；不能每次重建随机跳变或改变字形主结构。
test("carving is reproducible with small uneven cuts and variable widths", () => {
  const strokes = carvedStrokes("回");
  assert.deepEqual(strokes, carvedStrokes("回"));
  assert.notEqual(strokes[0].path, glyphs["回"][0]);
  assert.ok(strokes.every((s) => s.width >= 2.8 && s.width <= 3.8));
  const placed = engravingPlacements("回到未來", 0, 0, 154, 190);
  assert.deepEqual(placed, engravingPlacements("回到未來", 0, 0, 154, 190));
});

// 扫光低频、短促，减少动态时完全静止；休息阶段不应持续全字闪烁。
test("engraving glint crosses the inscription briefly and respects reduced motion", () => {
  const samples = Array.from({ length: 720 }, (_, i) => engravingSweep(i / 100, false));
  const active = samples.filter((p) => p >= 0 && p <= 1);
  assert.ok(active.length > 40 && active.length < 120);
  assert.ok(active.every((p, i) => i === 0 || p > active[i - 1]));
  assert.ok(samples.filter((p) => p === -1).length > 500);
  for (const t of [0, 2, 7.2, 1000]) assert.equal(engravingSweep(t, true), -1);
  assert.equal(engravingSweep(0, false), -1);
});
