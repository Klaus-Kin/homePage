import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// 不加载主模块，直接执行 HTML 守卫，覆盖最早可用的加载与失败出口。
function boot() {
  let timeout: () => void = () => {};
  let removed = false;
  const app = { dataset: { state: "loading" }, classList: { add() {} } };
  const loader = { remove() { removed = true; } };
  const window: any = {
    setTimeout(callback: () => void) { timeout = callback; return 1; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    window, clearTimeout() {}, Event: class {}, console: { warn() {} },
    document: { querySelector: (selector: string) => selector === "#app" ? app
      : selector === "#moon-loader" ? loader : { textContent: "" } },
  });
  return { window, app, expired: () => timeout(), removed: () => removed };
}

test("golden hoop and critical styles exist before the module entry", () => {
  assert.ok(html.indexOf('id="moon-loader"') < html.indexOf('id="entry-module"'));
  assert.match(html, /@keyframes hoop-spin/);
  assert.match(html, /hoop-spin 1\.8s linear infinite/);
  assert.match(html, /\.hoop-rotor\s*\{[^}]*will-change: transform/);
  assert.doesNotMatch(html, /drop-shadow/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  assert.match(html, /<noscript[\s\S]*#moon-loader[\s\S]*display: none/);
});

test("ready removes the loader and cancels fallback ownership", () => {
  const state = boot();
  assert.equal(state.removed(), false);
  assert.equal(state.window.__moonBoot.ready(), true);
  assert.equal(state.removed(), true);
  state.expired();
  assert.equal(state.window.__moonBoot.failed, false);
});

test("entry timeout removes the loader and rejects late readiness", () => {
  const state = boot();
  state.expired();
  assert.equal(state.removed(), true);
  assert.equal(state.app.dataset.state, "idle");
  assert.equal(state.window.__moonBoot.ready(), false);
});
