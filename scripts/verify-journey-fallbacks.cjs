// 覆盖减少动态、WebGL 与墨水画布故障、无脚本；只在实际黑场后结束受控旅程。
async (page) => {
  // 从当前服务的静态入口读取实际地址；独立无脚本文档不会启动额外的 WebGL 场景。
  const linkContext = await page.context().browser().newContext({ javaScriptEnabled: false });
  let destinations;
  try {
    const links = await linkContext.newPage();
    await links.goto(new URL(page.url()).origin);
    destinations = await links.locator("[data-entrance]").evaluateAll(links =>
      Object.fromEntries(links.map(link => [link.dataset.entrance, link.href])));
  } finally { await linkContext.close(); }
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  for (const scenario of ["reduced", "webgl", "ink-context", "ink-draw", "no-js"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      reducedMotion: scenario === "reduced" ? "reduce" : "no-preference", javaScriptEnabled: scenario !== "no-js" });
    const target = await context.newPage(), errors = [];
    // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
    await context.route("**/*", route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    target.setDefaultTimeout(30000);
    target.on("pageerror", error => errors.push(error.message));
    try {
      if (["webgl", "ink-context", "ink-draw"].includes(scenario)) await target.addInitScript(kind => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          if (kind === "webgl" && /webgl/i.test(type)) return null;
          if (kind === "ink-context" && this.dataset.inkSurface === "true") return null;
          return getContext.call(this, type, ...args);
        };
        if (kind === "ink-draw") {
          const fill = CanvasRenderingContext2D.prototype.fill;
          CanvasRenderingContext2D.prototype.fill = function(...args) {
            if (this.canvas.dataset.inkSurface === "true") throw new Error("injected ink drawing failure");
            return fill.apply(this, args);
          };
        }
      }, scenario);
      await target.goto(origin, { waitUntil: "domcontentloaded" });
      await target.bringToFront();
      if (scenario === "no-js") {
        if (await target.locator("#moon-loader").isVisible() || !await target.locator(".scene-fallback").isVisible())
          throw new Error("无脚本页面没有恢复静态入口");
        await target.route(destinations.blog, route => route.fulfill({ contentType: "text/html", body: "<h1>Native destination</h1>" }));
        await target.screenshot({ path: "output/playwright/lifecycle-no-js.png" });
        await target.locator("[data-entrance=blog]").click();
        await target.waitForURL(destinations.blog);
        results.push({ scenario, nativeNavigation: true });
        continue;
      }
      await target.waitForFunction(() => document.querySelector("#app")?.dataset.state === "idle" && !document.querySelector("#moon-loader"));
      const fallback = await target.locator("#app").evaluate(app => app.classList.contains("fallback"));
      if (fallback !== (scenario === "webgl")) throw new Error(`${scenario} 主场景降级不符合预期`);
      await target.clock.install();
      await target.clock.pauseAt(new Date(Date.now() + 100));
      await target.locator("[data-entrance=blog]").click({ noWaitAfter: true });
      const stages = new Set();
      let black = false;
      for (let i = 0; i < 700; i++) {
        await target.clock.runFor(16);
        const state = await target.locator("#ink-transition").evaluate(layer => ({ stage: layer.dataset.stage, black: layer.dataset.black }));
        if (state.stage) stages.add(state.stage);
        if (state.black === "true") { black = true; break; }
      }
      if (!black || (scenario !== "webgl" && !stages.has("fade"))) throw new Error(`${scenario} 没有通过安全淡黑完成旅程`);
      if (scenario === "webgl" && !stages.has("drop")) throw new Error("WebGL 降级错误地取消了独立墨滴动画");
      await target.screenshot({ path: `output/playwright/lifecycle-fallback-${scenario}.png` });
      await target.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
      await target.clock.resume();
      if (errors.length) throw new Error(JSON.stringify(errors));
      results.push({ scenario, fallback, stages: [...stages], black, errors });
    } finally { await context.close(); }
  }
  return results;
}
