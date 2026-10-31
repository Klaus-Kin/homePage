import { test } from "node:test";
import assert from "node:assert/strict";
import { InkTransition } from "../src/ink-transition.ts";
import { InkTimeline } from "../src/ink-timeline.ts";

// 用最小 DOM 与真实绘图控制器覆盖双缓冲交换；兼容性检查不能只测一个脱离渲染的工具函数。
function canvasHarness(t: any, detection: "missing" | "healthy" | "lost" | "invalid" | "draw-error" | "unavailable") {
  let draws = 0, contexts = 0;
  const errors: unknown[][] = [];
  class Element {
    id = ""; className = ""; hidden = true; width = 1; height = 1;
    dataset: Record<string, string> = {};
    style: Record<string, string> = {};
    children: Element[] = [];
    parent: Element | null = null;
    classList = { add() {}, remove() {} };
    setAttribute() {}
    append(...children: Element[]) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
    replaceWith(next: Element) {
      const index = this.parent!.children.indexOf(this);
      this.parent!.children[index] = next; next.parent = this.parent; this.parent = null;
    }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    getContext() {
      contexts++;
      if (detection === "unavailable") return null;
      const context: Record<string, any> = {
        setTransform() {}, clearRect() {}, beginPath() {}, ellipse() {}, stroke() {},
        moveTo() {}, quadraticCurveTo() {}, closePath() {}, save() {}, restore() {}, translate() {}, rotate() {},
        fill() { if (detection === "draw-error") throw new Error("injected draw failure"); draws++; },
      };
      if (detection === "healthy" || detection === "lost") context.isContextLost = () => detection === "lost";
      if (detection === "invalid") context.isContextLost = true;
      return context;
    }
  }
  const body = new Element();
  const globals = { document: { createElement: () => new Element(), body, documentElement: new Element() },
    window: { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 } };
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
  }
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  const glyph = { getBoundingClientRect: () => ({ left: 180, top: 300, width: 36, height: 50 }) } as SVGSVGElement;
  return { transition: new InkTransition(glyph), layer: () => body.children[0],
    draws: () => draws, contexts: () => contexts, errors };
}

// 缺少检测方法或拥有非函数同名值时仍须播放完整落墨、飞溅和扩散，不能误入淡黑。
for (const detection of ["missing", "healthy", "invalid"] as const) {
  test(`ink keeps its full 2400ms animation with ${detection} context-loss detection`, t => {
    const harness = canvasHarness(t, detection), timeline = new InkTimeline();
    for (const elapsed of [0, 64, 120, 240, 360, 1200, 2399]) {
      const frame = timeline.present(elapsed, true, false, harness.transition.unavailable);
      assert.equal(harness.transition.render(frame), false);
      assert.equal(harness.transition.unavailable, false);
      assert.notEqual(harness.layer().dataset.stage, "fade");
    }
    assert.ok(harness.draws() > 10);
    assert.equal(harness.errors.length, 0);
    assert.equal(harness.transition.render(timeline.present(2400, true, false)), true);
    assert.equal(harness.layer().dataset.black, "true");
    harness.transition.dispose();
  });
}

// 真正丢失、无法创建或绘制异常仍需报告故障，由原有时间轴完成新的 180ms 淡黑。
for (const detection of ["lost", "unavailable", "draw-error"] as const) {
  test(`ink retains its fallback for ${detection} canvas`, t => {
    const harness = canvasHarness(t, detection), timeline = new InkTimeline();
    harness.transition.render(timeline.present(0, true, false));
    assert.equal(harness.transition.unavailable, true);
    assert.equal(harness.errors.length, 1);
    assert.equal(timeline.present(0, true, false, true).stage, "fade");
    assert.equal(harness.transition.render(timeline.present(179, true, false, true)), false);
    assert.equal(harness.transition.render(timeline.present(180, true, false, true)), true);
    harness.transition.dispose();
  });
}

test("reduced motion uses the existing fade without creating canvas contexts", t => {
  const harness = canvasHarness(t, "missing"), timeline = new InkTimeline();
  harness.transition.render(timeline.present(0, true, true));
  assert.equal(harness.contexts(), 0);
  assert.equal(harness.transition.unavailable, false);
  assert.equal(harness.layer().dataset.stage, "fade");
  assert.equal(harness.transition.render(timeline.present(180, true, true)), true);
  harness.transition.dispose();
});
