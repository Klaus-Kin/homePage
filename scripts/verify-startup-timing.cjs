// 在同一生产服务上各测五次冷、热启动；冷启动使用独立上下文，热启动复用其 HTTP 缓存。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const browser = page.context().browser(), origin = new URL(page.url()).origin, samples = [];
  // 地址先保存，再停止驱动页自己的场景；否则它会与被测上下文争用 GPU，污染冷、热启动对照。
  await page.goto("about:blank");
  for (let trial = 0; trial < 5; trial++) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      await context.addInitScript(() => {
        window.__startupTiming = { tasks: [], frames: [], ready: 0, reveal: 0, phases: [] };
        new PerformanceObserver(list => window.__startupTiming.tasks.push(...list.getEntries().map(
          entry => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: "longtask", buffered: true });
        let previousPhase;
        new MutationObserver(() => {
          const app = document.querySelector("#app"), loader = document.querySelector("#moon-loader");
          if (app?.dataset.bootStage !== previousPhase) {
            previousPhase = app?.dataset.bootStage;
            window.__startupTiming.phases.push({ name: previousPhase, start: performance.now() });
          }
          if (loader?.classList.contains("revealing") && !window.__startupTiming.reveal)
            window.__startupTiming.reveal = performance.now();
          if (!loader && app?.dataset.state === "idle" && !window.__startupTiming.ready)
            window.__startupTiming.ready = performance.now();
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-state", "data-boot-stage"] });
      });
      const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; }), errors = [];
      // 明确保持被测页面在前台，减少驱动轮询被后台计时器节流干扰的情况。
      await target.bringToFront();
      target.on("pageerror", error => errors.push(error.message));
      for (const cache of ["cold", "warm"]) {
        await target.goto(origin, { waitUntil: "domcontentloaded" });
        await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 65000 });
        const startup = await target.evaluate(() => ({ ...window.__startupTiming,
          fallback: document.querySelector("#app").classList.contains("fallback"),
          initialization: JSON.parse(document.querySelector("#scene").dataset.initialization ?? "null"),
          // 对象级事件只汇总数量和 CPU 时间，避免报告被数千条重复提交记录淹没。
          gpuTotals: Object.fromEntries(["moon-gpu-object-compile-call", "moon-gpu-object-submit"].map(name => {
            const entries = performance.getEntriesByName(name);
            return [name, { count: entries.length, duration: entries.reduce((total, entry) => total + entry.duration, 0) }];
          })),
          measures: performance.getEntriesByType("measure").filter(entry => !entry.name.startsWith("moon-gpu-object-"))
            .map(({ name, startTime, duration }) => ({ name, startTime, duration })) }));
        if (startup.fallback || errors.length) throw new Error(JSON.stringify({ startup, errors }));
        // 就绪后立即激活首个提示，再接第一次开盖；用真实 RAF 和长任务记录检查成本是否后移。
        await target.evaluate(() => {
          window.__firstInteraction = performance.now();
          let previous = performance.now();
          const sample = now => {
            window.__startupTiming.frames.push(now - previous); previous = now;
            if (performance.now() - window.__firstInteraction < 3200) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
          document.querySelector("#box-button").click();
        });
        await target.waitForFunction(() => document.querySelector("#journey-choices").dataset.prompt !== "true");
        await target.locator("[data-entrance=blog]").evaluate(link => link.click());
        await target.waitForTimeout(1400);
        const firstInteraction = await target.evaluate(() => ({
          frames: window.__startupTiming.frames,
          longTasks: window.__startupTiming.tasks.filter(task => task.start >= window.__firstInteraction),
          opening: document.querySelector("#app").dataset.state,
        }));
        if (errors.length || firstInteraction.opening !== "transition") throw new Error(JSON.stringify({ errors, firstInteraction }));
        samples.push({ trial, cache, startup, firstInteraction });
      }
    } finally { await context.close(); }
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return { summary: ["cold", "warm"].map(cache => {
    const group = samples.filter(sample => sample.cache === cache);
    return { cache, readyMedianMs: median(group.map(sample => sample.startup.ready)),
      revealMedianMs: median(group.map(sample => sample.startup.ready - sample.startup.reveal)),
      startupLongTasks: group.map(sample => sample.startup.tasks.length),
      firstInteractionMaxFrameMedianMs: median(group.map(sample => Math.max(...sample.firstInteraction.frames))),
      firstInteractionLongTasks: group.map(sample => sample.firstInteraction.longTasks) };
  }), samples };
}
