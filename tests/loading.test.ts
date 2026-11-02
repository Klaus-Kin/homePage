import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderStaticHtml } from "../src/static-html.ts";
import { runInNewContext } from "node:vm";
import { renderCalligraphyCopy } from "../src/calligraphy.ts";
import { calligraphyGlyphs } from "../src/calligraphy-glyphs.ts";

const loadingSvg = renderCalligraphyCopy("月色正好,欢迎来访", true);
const html = renderStaticHtml(readFileSync(new URL("../index.html", import.meta.url), "utf8"), "/blog");

// 不加载主模块，直接执行 HTML 守卫，覆盖最早可用的加载与失败出口。
function boot(reduced = false, timeOrigin = 0, initialTime = 0, animationAvailable: boolean | "unrelated" | "throws" = true) {
  const timers = new Map<number, () => void>(), listeners = new Map<string, (event: any) => void>();
  const windowListeners = new Map<string, Set<(event: any) => void>>();
  const frames = new Map<number, () => void>();
  // 捕获浏览器实际注册的时限，确认缩短开幕后仍保留 100ms 事件缺失余量。
  const timerDelays: number[] = [];
  const measurements: { name: string; start: number; end: number }[] = [];
  let nextTimer = 0, timeout: () => void = () => {};
  let removed = false, reloaded = false, time = initialTime;
  // 记录真实动画时间写入，区分一次对齐与逐帧驱动，也模拟没有 Web Animations API 的浏览器。
  const alignedTimes: number[] = [];
  const spin = { animationName: "hoop-spin", set currentTime(value: number) { alignedTimes.push(value); } };
  const rotor = { style: { visibility: "hidden" }, getAnimations: animationAvailable ? () => {
    if (animationAvailable === "throws") throw new Error("animation inspection unavailable");
    return reduced ? [] : animationAvailable === "unrelated" ? [{ animationName: "loader-fade-out" }] : [spin];
  } : undefined };
  const classes = new Set<string>();
  const classList = { add(...names: string[]) { names.forEach(name => classes.add(name)); }, remove() {}, toggle() {} };
  const app = { dataset: { state: "loading" } as Record<string, string>, inert: false, classList };
  const loader: any = { classList, querySelector: () => rotor, remove() { removed = true; },
    addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
    removeEventListener(name: string) { listeners.delete(name); } };
  loader.cloneNode = () => loader;
  class Script { type = "module"; id = ""; src: string; constructor(src: string) { this.src = src; } }
  class RuntimeError { filename: string; message = "runtime error"; constructor(filename: string) { this.filename = filename; } }
  const entry = new Script("https://homepage.test/assets/index-entry.js");
  const root = { dataset: {} as Record<string, string> };
  const document = { hidden: false, documentElement: root, scripts: [entry],
    body: { prepend() { removed = false; } },
    addEventListener(name: string, callback: (event: any) => void) { windowListeners.set(name, new Set([callback])); },
    removeEventListener() {},
    querySelector: (selector: string) => selector === "#app" ? app
      : selector === "#moon-loader" ? (removed ? null : loader) : { textContent: "" } };
  const location = { href: "https://homepage.test/", origin: "https://homepage.test", reload() { reloaded = true; } };
  const dispatch = (name: string, event = {}) => windowListeners.get(name)?.forEach(callback => callback(event));
  const window: any = {
    setTimeout(callback: () => void, delay: number) {
      timerDelays.push(delay);
      const id = ++nextTimer; if (id === 1) timeout = callback; timers.set(id, callback); return id;
    },
    matchMedia() { return { matches: reduced, addEventListener() {}, removeEventListener() {} }; },
    addEventListener(name: string, callback: (event: any) => void) {
      if (!windowListeners.has(name)) windowListeners.set(name, new Set());
      windowListeners.get(name)!.add(callback);
    },
    removeEventListener(name: string, callback: (event: any) => void) { windowListeners.get(name)?.delete(callback); },
    dispatchEvent(event: { type: string }) { dispatch(event.type, event); }, location,
  };
  // 加载层的内联初始化必须在守卫之前执行；使用同一沙箱保持浏览器的脚本顺序。
  const sandbox = {
    window, clearTimeout(id: number) { timers.delete(id); }, Event: class { type: string; constructor(type: string) { this.type = type; } },
    HTMLScriptElement: Script, ErrorEvent: RuntimeError, URL, location, performance: { timeOrigin, now: () => time,
      measure(name: string, timing: { start: number; end: number }) { measurements.push({ name, ...timing }); } },
    requestAnimationFrame(callback: () => void) { const id = ++nextTimer; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); }, console: { warn() {} }, document,
  };
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) runInNewContext(script[1], sandbox);
  return { window, app, classes, root, entry, Script, RuntimeError, document, dispatch,
    reloaded: () => reloaded, expired: () => timeout(), removed: () => removed,
    frame: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    advance: (delta: number) => { time += delta; }, timers, timerDelays, measurements, alignedTimes, rotor,
    animationEnd: (name: string) => listeners.get("animationend")?.({ animationName: name, target: loader }),
    finishTimer: () => { for (const callback of [...timers.values()]) callback(); } };
}

// 两个文档的相对计时可以不同，但同一绝对时刻的金箍必须处于同一角度。
test("separate documents align the hoop before page content using a shared 1.8 second clock", () => {
  const first = boot(false, 1_700_000_000_000, 3127);
  const second = boot(false, 1_700_000_002_900, 227);
  assert.deepEqual(first.alignedTimes, second.alignedTimes);
  assert.deepEqual(first.alignedTimes, [(1_700_000_000_000 + 3127) % 1800]);
  assert.equal(first.rotor.style.visibility, "visible");
  first.advance(800); first.frame(); first.frame();
  assert.equal(first.alignedTimes.length, 1);
  assert.ok(html.indexOf("alignHoop(initialLoader)") < html.indexOf('<main id="app"'));
});

test("cached return aligns the restored hoop before reloading and the new document continues its phase", () => {
  const origin = 1_700_000_000_000, state = boot(false, origin, 137);
  state.window.__moonBoot.ready(); state.frame(); state.frame(); state.animationEnd("curtain-open-right");
  state.advance(9217);
  state.dispatch("pageshow", { persisted: false });
  assert.equal(state.alignedTimes.length, 1);
  state.dispatch("pageshow", { persisted: true });
  assert.equal(state.reloaded(), false);
  state.frame(); state.frame();
  assert.equal(state.reloaded(), true);
  assert.equal(state.alignedTimes[1], (origin + 9354) % 1800);
  const refreshed = boot(false, origin + 13_000, 1227);
  assert.equal((refreshed.alignedTimes[0] - state.alignedTimes[1] + 1800) % 1800, 1273);
});

test("reduced motion and missing rotation animation skip alignment without blocking boot or return", () => {
  for (const state of [boot(true), boot(false, 0, 0, false), boot(false, 0, 0, "unrelated"), boot(false, 0, 0, "throws")]) {
    assert.deepEqual(state.alignedTimes, []);
    assert.equal(state.rotor.style.visibility, "visible");
    state.window.__moonBoot.ready(); state.frame(); state.frame(); state.finishTimer();
    assert.equal(state.removed(), true);
    state.dispatch("pageshow", { persisted: true });
    state.frame(); state.frame();
    assert.equal(state.reloaded(), true);
    assert.deepEqual(state.alignedTimes, []);
    assert.equal(state.rotor.style.visibility, "visible");
  }
});

test("golden hoop and critical styles exist before the module entry", () => {
  assert.ok(html.indexOf('id="moon-loader"') < html.indexOf('id="entry-module"'));
  assert.match(html, /@keyframes hoop-spin/);
  assert.match(html, /hoop-spin 1\.8s linear infinite/);
  assert.match(html, /\.hoop-rotor\s*\{[^}]*will-change: transform/);
  assert.doesNotMatch(html, /drop-shadow/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  assert.match(html, /<noscript[\s\S]*#moon-loader[\s\S]*display: none/);
  // 无脚本与慢入口共用同一份静态内容，欢迎语只允许出现在加载层，主页品牌必须移除。
  // 欢迎语行书沿用题词字体来源，英文逗号与可访问文本一致，颜色仍继承加载层原金色。
  const labelStart = html.indexOf('<span class="loading-label">');
  assert.equal(html.slice(labelStart, html.indexOf('</div>', labelStart)).replace(/<[^>]+>/g, "").trim(), "月色正好,欢迎来访");
  assert.equal([...loadingSvg.matchAll(/data-calligraphy-character="([^"]+)"/g)].map(match => match[1]).join(""), "月色正好,欢迎来访");
  assert.match(loadingSvg, /fill="currentColor"/);
  assert.match(html, /#moon-loader\s*\{[^}]*color: #cbb77f;/);
  assert.doesNotMatch(loadingSvg, /<text|@font-face|<image|fill="#/);
  const inscription = readFileSync(new URL("../src/assets/inscription.svg", import.meta.url), "utf8");
  assert.equal(calligraphyGlyphs[","].path, inscription.match(/id="ink-0-3-full" d="([^"]+)"/)![1]);
  assert.equal((html.match(/class="loading-label"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /class="(?:site-header|brand|night-note)\b/);
});

// 加载图形必须先于体积较大的共享字形到达，暗色提示也不能依赖外链样式表。
test("first paint declares dark colors and parses the hoop before shared glyph definitions", () => {
  assert.match(html, /<meta name="color-scheme" content="dark"/);
  assert.ok(html.indexOf('id="moon-loader"') < html.indexOf('class="seal-glyph-bank"'));
  assert.ok(html.indexOf("alignHoop(initialLoader)") < html.indexOf('class="calligraphy-glyph-bank"'));
});

test("ready reveals the scene behind curtains and waits before allowing input", async () => {
  const state = boot();
  assert.equal(state.removed(), false);
  const reveal = state.window.__moonBoot.ready();
  state.frame(); state.frame();
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

test("entry timeout reveals the static scene through curtains and rejects late WebGL readiness", async () => {
  const state = boot();
  state.expired();
  assert.equal(state.removed(), false);
  assert.equal(state.app.inert, true);
  assert.equal(state.classes.has("boot-failed"), true);
  state.frame(); state.frame(); state.animationEnd("curtain-open-right");
  assert.equal(await state.window.__moonBoot.ready(), false);
  assert.equal(state.removed(), true);
  assert.equal(state.app.dataset.state, "idle");
});

// CSS 动画被取消或浏览器未派发完成事件时，兜底计时也必须解除交互锁。
test("curtain completion has a timer fallback and duplicate readiness cannot skip it", async () => {
  const state = boot(), reveal = state.window.__moonBoot.ready();
  state.frame(); state.frame();
  assert.equal(state.timerDelays.at(-1), 550);
  state.advance(550);
  state.finishTimer();
  assert.equal(await reveal, true);
  assert.equal(state.removed(), true);
  assert.equal(state.app.inert, false);
  assert.deepEqual(state.measurements, [{ name: "moon-loader-reveal", start: 0, end: 550 }]);
  const fallback = boot();
  const first = fallback.window.__moonBoot.ready();
  assert.equal(fallback.window.__moonBoot.ready(), first);
  assert.equal(fallback.removed(), false);
  fallback.frame(); fallback.frame(); fallback.animationEnd("curtain-open-right");
  assert.equal(await first, true);
  assert.equal(fallback.removed(), true);
});

test("reduced motion finishes on the short fade instead of moving curtains", async () => {
  const state = boot(true), reveal = state.window.__moonBoot.ready();
  state.frame(); state.frame();
  assert.equal(state.timerDelays.at(-1), 220);
  assert.equal(state.removed(), false);
  assert.equal(state.app.inert, true);
  state.animationEnd("loader-fade-out");
  assert.equal(await reveal, true);
  assert.equal(state.app.inert, false);
  assert.equal(state.removed(), true);
});

// 线上统计脚本失败不能拆掉幕布；真正入口失败仍必须恢复静态页面。
test("third-party module and runtime errors are isolated from the critical entry", () => {
  const state = boot();
  state.dispatch("error", { target: new state.Script("https://analytics.test/beacon.js") });
  state.dispatch("error", new state.RuntimeError("https://analytics.test/beacon.js"));
  assert.equal(state.window.__moonBoot.failed, false);
  assert.equal(state.removed(), false);
  state.dispatch("error", { target: state.entry });
  assert.equal(state.window.__moonBoot.failed, true);
  assert.equal(state.removed(), false);
});

// Vite 会把同源热更新模块插到入口之前，显式入口仍必须拥有独立的失败出口。
test("development client errors do not mask the explicitly identified entry failure", () => {
  const state = boot();
  state.entry.id = "entry-module";
  const client = new state.Script("https://homepage.test/@vite/client");
  state.document.scripts.unshift(client);
  state.dispatch("error", { target: client });
  assert.equal(state.window.__moonBoot.failed, false);
  state.dispatch("error", { target: state.entry });
  assert.equal(state.window.__moonBoot.failed, true);
});

// 真正阶段进展允许慢设备完成首次初始化；硬期限不能被心跳无限续期。
test("boot progress renews the stalled-stage watchdog without removing its hard deadline", () => {
  const state = boot();
  const first = [...state.timers.keys()];
  state.advance(10000);
  state.window.__moonBoot.progress("moon-texture");
  assert.equal(first.some(id => state.timers.has(id)), false);
  assert.equal(state.window.__moonBoot.failed, false);
  state.advance(60000);
  state.window.__moonBoot.progress("gpu-compile");
  state.finishTimer();
  assert.equal(state.window.__moonBoot.failed, true);
});

// 回退必须先同步展示加载画面，再发起刷新，不能把恢复的题词当作首帧。
test("persisted pageshow restores the loader and hides stale content before reload", () => {
  const state = boot();
  state.window.__moonBoot.ready(); state.frame(); state.frame(); state.animationEnd("curtain-open-right");
  assert.equal(state.removed(), true);
  state.dispatch("pageshow", { persisted: true });
  assert.equal(state.root.dataset.moonReturning, "true");
  assert.equal(state.removed(), false);
  assert.equal(state.app.dataset.state, "loading");
  assert.equal(state.app.inert, true);
  assert.equal(state.reloaded(), false);
  state.frame();
  assert.equal(state.reloaded(), false);
  state.frame();
  assert.equal(state.reloaded(), true);
});

// 锁屏或切后台不能耗尽启动预算；恢复时保留当前加载流程。
test("hidden time does not consume the foreground boot deadline", () => {
  const state = boot();
  state.advance(1000);
  state.document.hidden = true;
  state.dispatch("visibilitychange");
  assert.equal(state.timers.size, 0);
  state.advance(90000);
  state.document.hidden = false;
  state.dispatch("visibilitychange");
  assert.equal(state.window.__moonBoot.failed, false);
  assert.equal(state.timers.size, 1);
});
