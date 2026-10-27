import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// 不加载主模块，直接执行 HTML 守卫，覆盖最早可用的加载与失败出口。
function boot(reduced = false) {
  const timers = new Map<number, () => void>(), listeners = new Map<string, (event: any) => void>();
  let nextTimer = 0, timeout: () => void = () => {};
  let removed = false;
  const app = { dataset: { state: "loading" } as Record<string, string>, inert: false, classList: { add() {} } };
  const loader = { classList: { add() {} }, remove() { removed = true; },
    addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
    removeEventListener(name: string) { listeners.delete(name); } };
  const window: any = {
    setTimeout(callback: () => void) {
      const id = ++nextTimer; if (id === 1) timeout = callback; timers.set(id, callback); return id;
    },
    matchMedia() { return { matches: reduced, addEventListener() {}, removeEventListener() {} }; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    window, clearTimeout(id: number) { timers.delete(id); }, Event: class {}, console: { warn() {} },
    document: { querySelector: (selector: string) => selector === "#app" ? app
      : selector === "#moon-loader" ? loader : { textContent: "" } },
  });
  return { window, app, expired: () => timeout(), removed: () => removed,
    animationEnd: (name: string) => listeners.get("animationend")?.({ animationName: name, target: loader }),
    finishTimer: () => { for (const callback of timers.values()) callback(); } };
}

test("golden hoop and critical styles exist before the module entry", () => {
  assert.ok(html.indexOf('id="moon-loader"') < html.indexOf('id="entry-module"'));
  assert.match(html, /@keyframes hoop-spin/);
  assert.match(html, /hoop-spin 1\.8s linear infinite/);
  assert.match(html, /\.hoop-rotor\s*\{[^}]*will-change: transform/);
  assert.doesNotMatch(html, /drop-shadow/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  assert.match(html, /<noscript[\s\S]*#moon-loader[\s\S]*display: none/);
  // 无脚本与慢入口共用同一份静态内容，欢迎语只允许出现在加载层，主页品牌必须移除。
  assert.match(html, /<span class="loading-label">月色正好，欢迎来访<\/span>/);
  assert.equal(html.split("月色正好，欢迎来访").length - 1, 1);
  assert.doesNotMatch(html, /class="(?:site-header|brand|night-note)\b/);
});

test("ready reveals the scene behind curtains and waits before allowing input", async () => {
  const state = boot();
  assert.equal(state.removed(), false);
  const reveal = state.window.__moonBoot.ready();
  assert.equal(state.removed(), false);
  assert.equal(state.app.dataset.revealing, "true");
  assert.equal(state.app.inert, true);
  state.expired();
  assert.equal(state.window.__moonBoot.failed, false);
  // 欢迎语淡出及金箍事件不能提前拆除幕布；只接收最终右帘的完成事件。
  state.animationEnd("hoop-spin");
  assert.equal(state.removed(), false);
  state.animationEnd("curtain-open-right");
  assert.equal(await reveal, true);
  assert.equal(state.removed(), true);
  assert.equal(state.app.inert, false);
  assert.equal(state.app.dataset.revealing, undefined);
  assert.equal(await state.window.__moonBoot.ready(), true);
});

test("entry timeout removes the loader and rejects late readiness", async () => {
  const state = boot();
  state.expired();
  assert.equal(state.removed(), true);
  assert.equal(state.app.dataset.state, "idle");
  assert.equal(await state.window.__moonBoot.ready(), false);
});

// CSS 动画被取消或浏览器未派发完成事件时，兜底计时也必须解除交互锁。
test("curtain completion has a timer fallback and fallback scenes can skip it", async () => {
  const state = boot(), reveal = state.window.__moonBoot.ready();
  state.finishTimer();
  assert.equal(await reveal, true);
  assert.equal(state.removed(), true);
  assert.equal(state.app.inert, false);
  const fallback = boot();
  assert.equal(await fallback.window.__moonBoot.ready(true), true);
  assert.equal(fallback.removed(), true);
});

test("reduced motion finishes on the short fade instead of moving curtains", async () => {
  const state = boot(true), reveal = state.window.__moonBoot.ready();
  assert.equal(state.removed(), false);
  assert.equal(state.app.inert, true);
  state.animationEnd("loader-fade-out");
  assert.equal(await reveal, true);
  assert.equal(state.app.inert, false);
  assert.equal(state.removed(), true);
});
