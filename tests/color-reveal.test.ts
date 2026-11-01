import { test } from "node:test";
import assert from "node:assert/strict";
import { ColorReveal, ColorRevealClock, colorRevealMask, decodeCursor, targetColorReveal, synchronizeTargetColorReveal } from "../src/color-reveal.ts";

// 同一个文字/图标区域只启动一次；跨入口、更换手势和重入必须重新从零开始。
test("color reveal restarts on entry and target switches, clears immediately on exit", () => {
  const reveal = new ColorReveal(700), blog = {}, world = {};
  reveal.select(blog, 100);
  assert.equal(reveal.progress(100), 0);
  assert.equal(reveal.progress(450), .5);
  reveal.select(blog, 450);
  assert.equal(reveal.progress(800), 1);
  reveal.select(world, 900);
  assert.equal(reveal.progress(900), 0);
  reveal.select(null, 1000);
  assert.equal(reveal.progress(1000), 0);
  reveal.select(world, 1100);
  assert.equal(reveal.progress(1100), 0);
  assert.equal(reveal.progress(1100, true), 1);
  const grab = new ColorReveal(900);
  grab.select({}, 0);
  assert.equal(grab.progress(450), .5);
  assert.equal(grab.progress(900), 1);
});

// 柔边向上移动，首帧完全透明，尾帧完全原色，不能把从上向下的遮罩误用到图片。
test("color mask rises from below the image to above its top edge", () => {
  assert.equal(colorRevealMask(0), "linear-gradient(to bottom, transparent 100%, black 116%)");
  assert.equal(colorRevealMask(.5), "linear-gradient(to bottom, transparent 42%, black 58%)");
  assert.equal(colorRevealMask(1), "linear-gradient(to bottom, transparent -16%, black 0%)");
});

// 显式等待解码完成；失败或离页取消后不得隐藏对应原生指针。
test("cursor handoff waits for decoding and rejects failed or late images", async () => {
  const events = new AbortController();
  let done!: () => void, ready = false;
  const pending = decodeCursor({ decode: () => new Promise<void>(resolve => { done = resolve; }) }, events.signal)
    .then(value => { ready = value; });
  await Promise.resolve(); assert.equal(ready, false);
  done(); await pending; assert.equal(ready, true);
  assert.equal(await decodeCursor({ decode: async () => { throw new Error("decode failed"); } }, events.signal), false);
  events.abort();
  assert.equal(await decodeCursor({ decode: async () => {} }, events.signal), false);
});

// 后台时间从同一时基扣除，鼠标和模型恢复时不会分别跳到终点或改变水平边界。
test("shared color reveal time pauses in the background", () => {
  const clock = new ColorRevealClock(), reveal = new ColorReveal(700);
  reveal.select({}, clock.time(100));
  clock.setHidden(true, 450);
  assert.equal(reveal.progress(clock.time(10000)), .5);
  clock.setHidden(false, 10450);
  assert.equal(reveal.progress(clock.time(10450)), .5);
  assert.equal(reveal.progress(clock.time(10800)), 1);
});

// 静态 CSS 可以先于模块开始复色；接管起点、中段和终点后仍按剩余时长前进。
for (const progress of [0, .5, 1]) {
  test(`static handoff inherits ${progress} progress and keeps the 700ms timeline`, () => {
    const reveal = new ColorReveal(700), target = {};
    reveal.select(target, 1000);
    assert.equal(reveal.synchronize(progress, 1000), progress);
    assert.equal(reveal.progress(1175), Math.min(1, progress + .25));
    reveal.select(null, 1200);
    assert.equal(reveal.synchronize(1, 1200), 0);
    reveal.select(target, 1300);
    assert.equal(reveal.progress(1300), 0);
    assert.equal(reveal.progress(1650), .5);
  });
}

// 后备采样落后或同帧 RAF 时间戳较旧时不得回跳；无效采样不能污染共享时钟。
test("handoff only advances the current activation and tolerates stale frame timestamps", () => {
  const reveal = new ColorReveal(700), target = {};
  reveal.select(target, 0);
  assert.equal(reveal.progress(350), .5);
  assert.equal(reveal.synchronize(.2, 350), .5);
  assert.equal(reveal.synchronize(.75, 400), .75);
  assert.equal(reveal.progress(390), .75);
  assert.equal(reveal.synchronize(Number.NaN, 400), .75);
  assert.equal(reveal.synchronize(Infinity, 400), .75);
  assert.equal(reveal.progress(575), 1);
  reveal.select({}, 600);
  assert.equal(reveal.synchronize(-1, 600), 0);
  assert.equal(reveal.synchronize(2, 600), 1);
});

// 图标交接与鼠标读取必须命中同一个对象；禁用、失焦和移出都不能被旧 CSS 采样重新点亮。
test("target handoff shares cursor progress and clears on exit or disable", () => {
  let active = true, disabled = false;
  const target = { matches: (selector: string) => selector === ".journey-link" ? true
    : selector === ":hover, :focus-visible" ? active : disabled } as Element;
  assert.equal(synchronizeTargetColorReveal(target, .5, 1000), .5);
  assert.equal(targetColorReveal(target, 1175), .75);
  active = false;
  assert.equal(synchronizeTargetColorReveal(target, 1, 1200), 0);
  active = true;
  assert.equal(targetColorReveal(target, 1300), 0);
  assert.equal(synchronizeTargetColorReveal(target, 1, 1400), 1);
  disabled = true;
  assert.equal(synchronizeTargetColorReveal(target, 1, 1500), 0);
  disabled = false;
  assert.equal(targetColorReveal(target, 1600), 0);
  assert.equal(synchronizeTargetColorReveal(target, 0, 1600, true), 1);
});
