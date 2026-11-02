// 生产预览执行：独立 Chrome 窗口真实打开 DevTools，测量停靠后的鼠标与首屏帧。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const deviceScaleFactor of [1, 1.5]) for (const devtools of [false, true]) {
    // 独立临时浏览器不会接触用户正在使用的标签或调试器配置；关闭时统一释放。
    const browser = await page.context().browser().browserType().launch({
      channel: "chrome", headless: false,
      args: ["--window-size=1440,900", `--force-device-scale-factor=${deviceScaleFactor}`,
        ...(devtools ? ["--auto-open-devtools-for-tabs"] : [])],
    });
    try {
      const context = await browser.newContext({ viewport: null });
      await context.addInitScript(() => {
        window.__devtoolsReview = { ready: 0, tasks: [], frames: [], moves: [] };
        new PerformanceObserver(list => window.__devtoolsReview.tasks.push(...list.getEntries().map(entry => entry.duration)))
          .observe({ type: "longtask", buffered: true });
        new MutationObserver(() => {
          if (document.querySelector("#app")?.dataset.state === "idle" && !window.__devtoolsReview.ready)
            window.__devtoolsReview.ready = performance.now();
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
      });
      const target = await context.newPage(), errors = [];
      target.on("pageerror", error => errors.push(error.message));
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
      await target.waitForTimeout(1500);
      await target.evaluate(() => {
        let previous;
        const sample = now => {
          if (previous !== undefined) window.__devtoolsReview.frames.push(now - previous);
          previous = now;
          if (window.__devtoolsReview.frames.length < 180) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        addEventListener("pointermove", event => window.__devtoolsReview.moves.push(performance.now() - event.timeStamp), { passive: true });
      });
      const width = await target.evaluate(() => innerWidth);
      for (let i = 0; i < 100; i++) {
        await target.mouse.move(40 + (i * 17) % Math.max(100, width - 100), 140 + i % 15 * 12);
        await target.waitForTimeout(16);
      }
      await target.waitForFunction(() => window.__devtoolsReview.frames.length === 180);
      const result = await target.evaluate(() => {
        const data = window.__devtoolsReview;
        const stats = values => { const sorted = [...values].sort((a, b) => a - b);
          return { p95: sorted[Math.floor((sorted.length - 1) * .95)], max: sorted.at(-1) }; };
        return { ready: data.ready, frames: stats(data.frames), input: stats(data.moves), tasks: data.tasks,
          maxStartupTaskMs: Math.max(0, ...data.tasks),
          viewport: { width: innerWidth, height: innerHeight, outerWidth, outerHeight, devicePixelRatio },
          fallback: document.querySelector("#app").classList.contains("fallback"),
          diagnostics: document.querySelector("#scene").dataset.frames ?? null };
      });
      // DevTools 必须确实停靠、缩小页面宽度；否则该样本不能冒充 F12 验收。
      if (devtools && result.viewport.outerWidth - result.viewport.width < 200)
        throw new Error(`DevTools 没有停靠：${JSON.stringify(result.viewport)}`);
      // 新进程与高 DPI 一并捕获原先约 150ms 的缓冲重建；不要让热 GPU 的同上下文样本掩盖它。
      if (errors.length || result.fallback || result.diagnostics !== null || result.frames.p95 > 34 ||
        Math.abs(result.viewport.devicePixelRatio - deviceScaleFactor) > .03)
        throw new Error(JSON.stringify({ devtools, result, errors }));
      await target.screenshot({ path: `output/playwright/after-devtools-${devtools ? "open" : "closed"}${deviceScaleFactor === 1 ? "" : "-dpr-1.5"}.png` });
      results.push({ devtools, deviceScaleFactor, ...result, errors });
    } finally { await browser.close(); }
  }
  // 四种真实窗口都完成后再报告启动预算，保留失败样本；不能因为交互流畅而掩盖首次启动峰值。
  if (results.some(result => result.maxStartupTaskMs > 100))
    throw new Error(`启动长任务预算未达标：${JSON.stringify(results)}`);
  return results;
}
