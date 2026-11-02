// 生产预览模拟 Worker 缺失、脚本加载失败及消息解码错误；所有路径均须保留可操作的完整场景。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const mode of ["unsupported", "load-failure", "message-error"]) {
    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const target = await context.newPage(), errors = [];
    target.on("pageerror", error => errors.push(error.message));
    try {
      await context.addInitScript(mode => {
        const OriginalWorker = Worker;
        window.__workerReview = { created: 0, terminated: 0 };
        if (mode === "unsupported") window.Worker = class { constructor() { throw new Error("injected worker unsupported"); } };
        else window.Worker = class extends OriginalWorker {
          constructor(url, options) { super(url, options); window.__workerReview.created++; }
          terminate() { window.__workerReview.terminated++; return super.terminate(); }
          postMessage(message, ...args) {
            if (mode === "message-error" && message.job) {
              queueMicrotask(() => this.onmessageerror?.(new MessageEvent("messageerror")));
              return;
            }
            return super.postMessage(message, ...args);
          }
        };
      }, mode);
      if (mode === "load-failure") await target.route("**/assets/terrain-worker-*.js", route => route.abort());
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
      const state = await target.evaluate(() => ({ fallback: document.querySelector("#app").classList.contains("fallback"),
        canvases: document.querySelectorAll("#scene canvas").length, ...window.__workerReview }));
      if (errors.length || state.fallback || state.canvases !== 1 ||
        (mode !== "unsupported" && (state.created !== 1 || state.terminated !== 1)))
        throw new Error(JSON.stringify({ mode, state, errors }));
      await target.locator("#box-button").click();
      await target.waitForFunction(() => document.querySelector("#journey-choices").dataset.prompt !== "true");
      await target.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
      if (await target.locator("#scene canvas").count()) throw new Error(`${mode}: 离页没有释放场景`);
      results.push({ mode, ...state, errors, disposed: true });
    } finally { await context.close(); }
  }
  return results;
}
