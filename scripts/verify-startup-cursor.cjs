// 冷/热启动期间持续移动鼠标；加载和拉幕阶段必须保留浏览器原生光标，避免主线程阻塞拖住指针。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const rate of [1, 4]) {
    const context = await page.context().browser().newContext({ viewport: { width: 1366, height: 768 } });
    let release, target;
    try {
      await context.addInitScript(() => {
        window.__cursorStartup = { longTasks: [], frameGaps: [], moves: [], samples: [] };
        const sample = window.__cursorStartup;
        new PerformanceObserver((list) => {
          sample.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
        }).observe({ type: "longtask", buffered: true });
        let previous;
        const frame = (now) => {
          const loader = document.querySelector("#moon-loader");
          if (previous !== undefined) sample.frameGaps.push(now - previous);
          previous = now;
          if (loader) {
            sample.samples.push({ native: getComputedStyle(document.documentElement).cursor !== "none",
              hidden: document.querySelector(".staff-cursor-layer")?.hidden ?? true,
              revealing: loader.classList.contains("revealing") });
            requestAnimationFrame(frame);
          }
        };
        // 慢速解析时首个 RAF 可能早于加载层节点，等 DOM 就绪再采样，避免把“尚未解析”误当作已结束。
        document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(frame), { once: true });
        window.addEventListener("pointermove", (event) => {
          if (document.querySelector("#moon-loader"))
            sample.moves.push({ delay: performance.now() - event.timeStamp,
              native: getComputedStyle(document.documentElement).cursor !== "none" });
        }, { passive: true });
      });
      target = await context.newPage();
      await target.bringToFront();
      const cdp = await context.newCDPSession(target);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      for (const cache of ["cold", "warm"]) {
        const gate = new Promise((resolve) => { release = resolve; });
        const pattern = /\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/;
        await target.route(pattern, async (route) => { await gate; await route.continue(); });
        const requested = target.waitForRequest(pattern);
        await target.goto(origin, { waitUntil: "domcontentloaded" });
        await requested;
        await target.mouse.move(500, 300);
        await target.waitForFunction(() => document.querySelector(".staff-cursor-layer img")?.complete);
        const waiting = await target.evaluate(() => ({
          cursor: getComputedStyle(document.documentElement).cursor,
          hidden: document.querySelector(".staff-cursor-layer").hidden,
        }));
        if (waiting.cursor === "none" || !waiting.hidden)
          throw new Error(`加载时仍由主线程图片模拟光标：${JSON.stringify({ rate, cache, waiting })}`);
        release();
        // 由浏览器协议发送真实鼠标输入，不能用页面计时器模拟，否则输入本身也会随主线程一起停住。
        let moving = true, step = 0;
        const motion = (async () => {
          while (moving) {
            await target.mouse.move(300 + (step++ % 24) * 20, 250 + (step % 8) * 15);
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        })();
        try {
          await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 20000 });
        } finally { moving = false; await motion; }
        await target.unroute(pattern);
        const sample = await target.evaluate(() => ({
          ...window.__cursorStartup,
          fallback: document.querySelector("#app").classList.contains("fallback"),
          initialization: JSON.parse(document.querySelector("#scene").dataset.initialization ?? "null"),
        }));
        if (sample.fallback || !sample.initialization || !sample.moves.length ||
            !sample.samples.some((item) => item.revealing) ||
            sample.samples.some((item) => !item.native || !item.hidden) ||
            sample.moves.some((item) => !item.native))
          throw new Error(`启动或拉幕时的光标发生回归：${JSON.stringify({ rate, cache,
            fallback: sample.fallback, initialized: !!sample.initialization,
            moves: sample.moves.length, samples: sample.samples })}`);
        await target.mouse.move(700, 400);
        await target.waitForSelector(".staff-cursor-layer:not([hidden])");
        const restored = await target.locator(".staff-cursor-layer img").evaluate((image) => {
          const bounds = image.getBoundingClientRect();
          return bounds.x === 694 && bounds.y === 394 && bounds.width === 72 && bounds.height === 72 &&
            getComputedStyle(document.documentElement).cursor === "none";
        });
        if (!restored) throw new Error("就绪后未恢复原方向、尺寸和热点的金箍棒光标");
        // 长任务数据用于定位启动成本；原生光标不依赖这些任务结束后才移动。
        results.push({ rate, cache, loadingUsesNativeCursor: true, restored,
          moves: sample.moves.length, maxInputDelayMs: Math.max(...sample.moves.map((item) => item.delay)),
          maxFrameGapMs: Math.max(...sample.frameGaps), longTasks: sample.longTasks,
          firstSubmitMs: sample.initialization.firstSubmitMs });
      }
    } finally {
      // 先放行并等拦截器结束，再关闭页面，避免失败路径留下悬空的网络处理任务。
      release?.();
      await target?.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }
  // 鼠标静止时也必须完成加载后的交接；降级和离页不能留下观察器或复活已销毁的图层。
  for (const exit of ["ready", "scene-failure", "pagehide"]) {
    const context = await page.context().browser().newContext({
      viewport: { width: 1366, height: 768 }, reducedMotion: "reduce",
    });
    const target = await context.newPage();
    await target.bringToFront();
    let release;
    try {
      const gate = new Promise((resolve) => { release = resolve; });
      const pattern = /\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/;
      await target.route(pattern, async (route) => {
        await gate;
        if (exit === "scene-failure") await route.abort();
        else await route.continue();
      });
      const requested = target.waitForRequest(pattern);
      await target.goto(origin, { waitUntil: "domcontentloaded" });
      await requested;
      await target.mouse.move(600, 300);
      await target.waitForFunction(() => document.querySelector(".staff-cursor-layer img")?.naturalWidth > 0);
      if (exit === "pagehide") {
        await target.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent("pagehide"));
          document.querySelector("#moon-loader").remove();
        });
        // 同一轮微任务中的 MutationObserver 也必须完成，不能只在 dispose 调用前检查。
        await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        const disposed = await target.evaluate(() => !document.querySelector(".staff-cursor-layer") &&
          !document.documentElement.classList.contains("staff-cursor-active"));
        if (!disposed) throw new Error("离页后加载层移除又恢复了光标图层");
        results.push({ exit, disposed });
      } else {
        release();
        await target.waitForSelector('#app[data-state="idle"]:not([inert])');
        await target.waitForSelector(".staff-cursor-layer:not([hidden])");
        const stationary = await target.locator(".staff-cursor-layer img").evaluate((image) => {
          const bounds = image.getBoundingClientRect();
          return bounds.x === 594 && bounds.y === 294;
        });
        if (!stationary) throw new Error(`${exit}: 静止鼠标的光标交接位置错误`);
        results.push({ exit, stationary });
      }
    } finally {
      release?.();
      await target.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }
  return results;
}
