// 使用生产预览：playwright-cli run-code --filename scripts/verify-performance-regression.cjs。
// 驱动页可带 ?baseline=http://127.0.0.1:4180，对比同机 Git HEAD；结果写入 window.__performanceRegression。
async (page) => {
  const address = new URL(page.url()), origin = address.origin, browser = page.context().browser();
  const baseline = address.searchParams.get("baseline");
  const versions = baseline ? [["before", baseline], ["after", origin]] : [["after", origin]];
  if (versions.some(([, url]) => !["127.0.0.1", "localhost"].includes(new URL(url).hostname)))
    throw new Error("性能对照只允许本地服务");
  await page.goto("about:blank");
  const results = [], scenarios = [];
  const instrument = () => {
    window.__moonDiagnostics = true;
    window.__perf = { ready: 0, tasks: [], gaps: [], moves: [] };
    new PerformanceObserver(list => window.__perf.tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))))
      .observe({ type: "longtask", buffered: true });
    new MutationObserver(() => {
      if (document.querySelector("#app")?.dataset.state === "idle" && !window.__perf.ready) window.__perf.ready = performance.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    window.addEventListener("pointermove", event => window.__perf.moves.push(performance.now() - event.timeStamp), { passive: true });
    document.addEventListener("DOMContentLoaded", () => {
      let previous;
      const frame = now => {
        if (previous !== undefined) window.__perf.gaps.push(now - previous);
        previous = now;
        if (!window.__perf.ready) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { once: true });
  };
  for (let trial = 0; trial < 5; trial++) for (const [version, url] of versions) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(instrument);
    const target = await context.newPage(), errors = [];
    target.on("pageerror", error => errors.push(error.message));
    try {
      for (const cache of ["cold", "warm"]) {
        await target.goto(url, { waitUntil: "domcontentloaded" });
        await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
        const sample = await target.evaluate(() => {
          const data = window.__perf;
          const measures = performance.getEntriesByType("measure").filter(entry => /^moon-(generation|parallel-gpu|gpu-choice|gpu-opening|loader-reveal|gpu-texture-upload)/.test(entry.name))
            .map(({ name, duration }) => ({ name, duration }));
          return { ready: data.ready, longTasks: data.tasks.filter(task => task.start < data.ready),
            maxStartupFrameMs: Math.max(0, ...data.gaps), measures,
            fallback: document.querySelector("#app").classList.contains("fallback") };
        });
        if (sample.fallback || errors.length) throw new Error(JSON.stringify({ version, cache, errors, sample }));
        results.push({ version, trial, cache, ...sample });
      }
    } finally { await context.close(); }
  }
  // 启动样本结束后才测交互，避免另一个页面、外部路由拦截或 CPU 限速污染 HTTP 冷热缓存。
  for (const [name, viewport, rate] of [["desktop", { width: 1366, height: 768 }, 1],
    ["desktop-cpu4", { width: 1366, height: 768 }, 4], ["mobile-cpu4", { width: 390, height: 844 }, 4],
    ["short", { width: 844, height: 390 }, 1]]) {
    const context = await browser.newContext({ viewport, isMobile: name.startsWith("mobile"), hasTouch: name.startsWith("mobile") });
    await context.addInitScript(instrument);
    const target = await context.newPage(), errors = [];
    target.on("pageerror", error => errors.push(error.message));
    const cdp = await context.newCDPSession(target);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    try {
      await target.goto(origin, { waitUntil: "domcontentloaded" });
      await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
      const startup = await target.evaluate(() => ({ ready: window.__perf.ready, tasks: window.__perf.tasks }));
      await target.evaluate(() => {
        window.__perf.moves = []; window.__perf.gaps = [];
        let previous = performance.now(), start = previous;
        const frame = now => { window.__perf.gaps.push(now - previous); previous = now;
          if (now - start < 2500) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
      });
      for (let i = 0; i < 95; i++) {
        await target.mouse.move(50 + (i % 18) * (viewport.width - 100) / 18, 100 + i % 12 * 8);
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      const moving = await target.evaluate(() => {
        const percentile = values => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * .95)];
        return { frameP95: percentile(window.__perf.gaps), frameMax: Math.max(...window.__perf.gaps),
          inputP95: percentile(window.__perf.moves), inputMax: Math.max(...window.__perf.moves) };
      });
      const destinations = await target.locator("[data-entrance]").evaluateAll(links => links.map(link => link.href));
      // 本轮同时验证首个提示和首次开盖；预热缩短后不能在第一击重新出现编译停顿。
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue()
        : destinations.includes(route.request().url()) ? route.fulfill({ contentType: "text/html", body: "<!doctype html><title>受控目的页</title>" }) : route.abort());
      await target.locator("#box-button").click();
      await target.waitForFunction(() => document.querySelector("#journey-choices").dataset.prompt !== "true");
      await target.locator("[data-entrance=blog]").click({ noWaitAfter: true });
      await target.waitForTimeout(1100);
      const opening = await target.evaluate(() => ({ state: document.querySelector("#app").dataset.state,
        lid: Number(document.querySelector("#scene").dataset.lidAngle) }));
      if (errors.length || opening.state !== "transition" || opening.lid < 150)
        throw new Error(JSON.stringify({ name, errors, opening }));
      scenarios.push({ name, startup, moving, opening });
    } finally { await context.close(); }
  }
  const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = versions.flatMap(([version]) => ["cold", "warm"].map(cache => {
    const group = results.filter(result => result.version === version && result.cache === cache);
    return { version, cache, readyMedianMs: median(group.map(result => result.ready)),
      maxLongTaskMs: Math.max(0, ...group.flatMap(result => result.longTasks.map(task => task.duration))) };
  }));
  const report = { capturedAt: new Date().toISOString(), summary, scenarios, results, physicalDeviceVerified: false };
  await page.evaluate(report => { window.__performanceRegression = report; }, report);
  return report;
}
