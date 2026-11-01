// 仅开发服务：拦截主场景源码注入故障，验证真实生命周期与降级旅程；不向产品暴露测试接口。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  const modes = new URL(page.url()).searchParams.get("modes")?.split(",") ||
    ["animation", "resize", "preference", "hover", "transition", "cancel", "visibility", "quality", "context", "initialization", "dispose"];
  for (const mode of modes) {
    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
    const target = await context.newPage(), errors = [], external = [];
    target.on("pageerror", error => errors.push(error.message));
    // 所有非本地请求均被截断；稍后只为当前入口地址提供受控目的页。
    await context.route("**/*", route => new URL(route.request().url()).origin === origin
      ? route.continue() : (external.push(route.request().url()), route.abort()));
    let intercepted = false;
    await target.route(/\/src\/scene\.ts(?:\?|$)/, async route => {
      intercepted = true;
      const response = await route.fetch();
      let source = await response.text();
      const inject = (before, after) => {
        if (!source.includes(before)) throw new Error(`场景注入锚点失效：${before}`);
        source = source.replace(before, after);
      };
      inject("const init = new Initialization(undefined, undefined, onProgress);", `
        const init = new Initialization(undefined, undefined, onProgress);
        const review = window.__sceneReview = { init, failures: 0, faults: 0, released: new Map(),
          fault: ${JSON.stringify(mode === "initialization" ? "draw" : "")}, rendererDisposals: 0, losses: 0 };
        const report = onFailure;
        onFailure = error => { review.failures++; report(error); };
        const release = init.release.bind(init);
        init.release = resource => {
          if (!review.released.has(resource)) {
            review.released.set(resource, 0);
            const disposeResource = resource.dispose.bind(resource);
            resource.dispose = () => {
              review.released.set(resource, review.released.get(resource) + 1); disposeResource();
            };
          }
          release(resource);
        };
      `);
      inject("renderer.outputColorSpace =", `
        review.gl = renderer.getContext();
        const reviewDraw = renderer.render.bind(renderer), reviewSize = renderer.setDrawingBufferSize.bind(renderer);
        renderer.render = (...args) => {
          if (review.fault === "draw") { review.faults++; throw new Error("injected scene draw failure"); }
          return reviewDraw(...args);
        };
        renderer.setDrawingBufferSize = (...args) => {
          if (review.fault === "resize") { review.faults++; throw new Error("injected scene resize failure"); }
          return reviewSize(...args);
        };
        const destroy = renderer.dispose.bind(renderer), lose = renderer.forceContextLoss.bind(renderer);
        renderer.dispose = () => { review.rendererDisposals++; destroy(); };
        renderer.forceContextLoss = () => { review.losses++; lose(); };
        renderer.outputColorSpace =`);
      inject("terrain = await createTerrain(init);", `
        terrain = await createTerrain(init);
        const quality = terrain.setQuality.bind(terrain);
        terrain.setQuality = (...args) => {
          if (review.fault === "quality") { review.faults++; return Promise.reject(new Error("injected quality failure")); }
          if (review.fault === "pending") return new Promise((resolve, reject) => { review.rejectQuality = reject; });
          return quality(...args);
        };
      `);
      if (!/return \{\s*promptChoice\(\)/.test(source)) throw new Error("未找到场景公开命令");
      source = source.replace(/return \{\s*promptChoice\(\)/, "return review.api = {\n    promptChoice()");
      await route.fulfill({ response, body: source });
    });
    try {
      await target.goto(origin);
      if (!intercepted) throw new Error("本脚本要求 Vite 开发服务，不能在生产预览执行");
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      const destinations = await target.locator("[data-entrance]").evaluateAll(links => links.map(link => link.href));
      if (mode !== "initialization") {
        if (mode !== "animation") await target.emulateMedia({ reducedMotion: "reduce" });
        await target.evaluate(mode => {
          const r = window.__sceneReview, api = r.api;
          r.fault = mode === "resize" ? "resize" : mode === "quality" ? "quality" : "draw";
          if (mode === "resize" || mode === "quality") api.resize();
          if (mode === "hover") api.setHover(true);
          if (mode === "transition") api.setTransition(.1);
          if (mode === "cancel") { api.promptChoice(); api.cancelChoicePrompt(); }
          if (mode === "visibility") document.dispatchEvent(new Event("visibilitychange"));
          if (mode === "context") { r.fault = ""; r.gl.getExtension("WEBGL_lose_context").loseContext(); }
          if (mode === "dispose") {
            r.fault = "pending"; api.resize(); api.dispose(); api.dispose();
            r.rejectQuality(new Error("late cancelled quality"));
          }
        }, mode);
        if (mode === "resize") await target.setViewportSize({ width: 391, height: 844 });
        if (mode === "preference") await target.emulateMedia({ reducedMotion: "no-preference" });
      }
      if (mode !== "dispose") await target.waitForSelector("#app.fallback", { timeout: 2500 }).catch(async () => {
        const faults = await target.evaluate(() => window.__sceneReview.faults);
        throw new Error(`${mode}: 故障后未降级，绘制失败 ${faults} 次，未捕获异常 ${errors.length} 次：${errors.slice(0, 3).join(", ")}`);
      });
      const frames = await target.locator("#scene").getAttribute("data-frames");
      // 故障后再次调用公开命令与偏好/可见性事件，不能重启绘制或重复通知。
      await target.evaluate(() => {
        const api = window.__sceneReview.api;
        if (!api) return;
        api.resize(); api.setReducedMotion(false); api.cancelChoicePrompt(); api.setHover(true); api.setTransition(.5);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await target.waitForTimeout(150);
      const state = await target.evaluate(() => {
        const r = window.__sceneReview;
        return { failures: r.failures, faults: r.faults, resources: r.init.resources.size, cleanups: r.init.cleanups.size,
          aborted: r.init.controller.signal.aborted, contextLost: r.gl.isContextLost(),
          rendererDisposals: r.rendererDisposals, losses: r.losses,
          duplicateReleases: [...r.released.values()].filter(count => count > 1).length,
          canvases: document.querySelectorAll("#scene canvas").length, frames: document.querySelector("#scene").dataset.frames };
      });
      if (errors.length || state.canvases || state.resources || state.cleanups || !state.aborted || !state.contextLost ||
          state.rendererDisposals !== 1 || state.losses !== 1 || state.duplicateReleases || state.frames !== (frames ?? undefined) ||
          state.failures !== (["initialization", "dispose"].includes(mode) ? 0 : 1))
        throw new Error(`${mode}: ${JSON.stringify({ state, errors })}`);
      // 两个入口分别在独立文档中走完降级旅程，验证黑场后只导航一次。
      if (["animation", "preference"].includes(mode)) {
        const destination = destinations[mode === "animation" ? 0 : 1];
        let navigations = 0;
        await context.route(url => url.href === destination, route => {
          navigations++; return route.fulfill({ contentType: "text/html", body: "<h1>Runtime fallback destination</h1>" });
        });
        await target.emulateMedia({ reducedMotion: "reduce" });
        await target.locator(`[data-entrance=${mode === "animation" ? "blog" : "world"}]`).click();
        await target.waitForURL(destination);
        if (navigations !== 1) throw new Error("降级旅程没有仅导航一次");
      }
      if (external.length) throw new Error(`意外外站请求：${external.join(", ")}`);
      results.push({ mode, ...state, errors, external });
    } finally { await context.close(); }
  }
  return results;
}
