// 生产预览执行：模拟 F12 停靠跨断点，验证普通页面无逐帧诊断写入和慢帧原生光标回退。
async (page) => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({ viewport: { width: 1366, height: 768 } });
  const target = await context.newPage(), errors = [];
  target.on("pageerror", error => errors.push(error.message));
  try {
    await target.goto(origin);
    await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
    await target.evaluate(() => {
      window.__resizeReview = { mutations: [], tasks: [] };
      new MutationObserver(records => window.__resizeReview.mutations.push(...records.map(record => record.attributeName)))
        .observe(document.querySelector("#scene"), { attributes: true });
      new PerformanceObserver(list => window.__resizeReview.tasks.push(...list.getEntries().map(entry => entry.duration)))
        .observe({ type: "longtask" });
    });
    for (let i = 0; i < 30; i++) await target.mouse.move(100 + i * 18, 100 + i % 5 * 10);
    await target.waitForTimeout(250);
    const ordinary = await target.evaluate(() => ({ mutations: window.__resizeReview.mutations,
      diagnostics: document.querySelector("#scene").dataset.frames ?? null }));
    if (ordinary.diagnostics !== null || ordinary.mutations.some(name => name !== "data-performance-level"))
      throw new Error(`普通访问仍有逐帧诊断写入：${JSON.stringify(ordinary)}`);
    const cdp = await context.newCDPSession(target);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (const [width, height] of [[1000, 768], [740, 768], [1366, 768], [1366, 450], [1366, 768]]) {
      await target.setViewportSize({ width, height });
      await target.waitForTimeout(220);
    }
    await target.waitForTimeout(2200);
    const stable = await target.evaluate(() => new Promise(resolve => {
      const gaps = []; let previous;
      const sample = now => { if (previous !== undefined) gaps.push(now - previous); previous = now;
        if (gaps.length < 90) requestAnimationFrame(sample);
        else { gaps.sort((a, b) => a - b); resolve({ p95: gaps[84], max: gaps.at(-1) }); } };
      requestAnimationFrame(sample);
    }));
    await target.mouse.move(100, 100);
    await target.evaluate(() => window.dispatchEvent(new Event("moon-slow-frames")));
    await target.waitForFunction(() => document.documentElement.classList.contains("staff-cursor-native"));
    const cursors = [];
    for (const selector of ["body", "[data-entrance=blog]", "#box-button"]) {
      cursors.push(await target.locator(selector).evaluate(element => getComputedStyle(element).cursor));
    }
    const state = await target.evaluate(() => ({ layout: document.querySelector("#scene").dataset.layout,
      fallback: document.querySelector("#app").classList.contains("fallback"),
      canvas: document.querySelectorAll("#scene canvas").length,
      hiddenDOMCursor: document.querySelector(".staff-cursor-layer").hidden,
      longTasks: window.__resizeReview.tasks }));
    if (errors.length || state.fallback || state.canvas !== 1 || !state.hiddenDOMCursor || stable.p95 > 34 ||
      !cursors.every(cursor => cursor.includes("url("))) throw new Error(JSON.stringify({ state, stable, cursors, errors }));
    await target.screenshot({ path: "output/playwright/after-resize-desktop.png" });
    return { ordinary, stable, state, cursors, errors, physicalDeviceVerified: false };
  } finally { await context.close(); }
}
