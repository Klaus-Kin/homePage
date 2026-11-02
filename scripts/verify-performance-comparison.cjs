// playwright-cli 执行回调；第二参数需传 baselineUrl，可选 cpu/mobile/trials。两版交错运行，禁止并行争用 GPU。
async (page, { baselineUrl, candidateUrl = "http://127.0.0.1:4173", cpu = 1, mobile = false, trials = 5, startupOnly = false } = {}) => {
  if (!baselineUrl || trials < 5) throw new Error("需要原版生产地址，并至少采样五轮");
  await page.goto("about:blank");
  const browser = page.context().browser(), samples = [];
  const percentile = values => {
    values.sort((a, b) => a - b);
    const at = ratio => values[Math.ceil(values.length * ratio) - 1] ?? 0;
    return { count: values.length, median: at(.5), p95: at(.95), p99: at(.99), max: values.at(-1) ?? 0 };
  };
  const summarize = data => ({ ready: data.ready, transferBytes: data.transferBytes, phases: Object.fromEntries([...new Set(data.frames.map(f => f.stage))].map(stage => [stage, {
    frames: percentile(data.frames.filter(f => f.stage === stage).map(f => f.gap)),
    inputs: percentile(data.inputs.filter(f => f.stage === stage).map(f => f.delay)),
  }])), tasks: data.tasks, resources: data.resources, measures: data.measures });
  for (let trial = 0; trial < trials; trial++) {
    // 偶数轮先原版、奇数轮先候选版，降低驱动预热和机器温度随时间变化的偏差。
    const variants = trial % 2 ? [["after", candidateUrl], ["before", baselineUrl]] : [["before", baselineUrl], ["after", candidateUrl]];
    for (const [variant, origin] of variants) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
        deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
      const errors = [];
      await context.addInitScript(() => {
        window.__moonDiagnostics = true;
        const sample = window.__comparison = { frames: [], inputs: [], tasks: [], states: [], ready: 0 };
        const phase = () => {
          if (document.querySelector("#moon-loader")) return "loading";
          if (document.querySelector("#journey-choices")?.dataset.prompt === "true") return "prompt";
          if (document.querySelector("#app")?.dataset.state === "transition") {
            const ink = document.querySelector("#ink-transition")?.dataset.stage;
            if (ink && ink !== "waiting") return "ink";
            if (document.querySelector("#inscription")?.dataset.visible === "true") return "writing";
            return +document.querySelector("#whiteout")?.dataset.spread > 0 ? "light" : "opening";
          }
          return "idle";
        };
        let previous, previousPhase;
        function frame(now) {
          const stage = phase();
          if (stage !== previousPhase) { sample.states.push({ stage, time: now }); previousPhase = stage; }
          if (previous !== undefined && !document.hidden) sample.frames.push({ stage, gap: now - previous });
          previous = now; requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        new MutationObserver(() => {
          if (!sample.ready && !document.querySelector("#moon-loader") && document.querySelector("#app")?.dataset.state === "idle")
            sample.ready = performance.now();
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-state"] });
        document.addEventListener("pointermove", event => sample.inputs.push({ stage: phase(), delay: Math.max(0, performance.now() - event.timeStamp) }), { passive: true });
        new PerformanceObserver(list => sample.tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))))
          .observe({ type: "longtask", buffered: true });
        window.__collectComparison = () => ({ ...sample,
          transferBytes: performance.getEntriesByType("resource").reduce((sum, entry) => sum + entry.transferSize, 0),
          fallback: document.querySelector("#app").classList.contains("fallback"),
          resources: JSON.parse(document.querySelector("#scene").dataset.resources ?? "null"),
          measures: performance.getEntriesByType("measure").filter(e => !e.name.startsWith("moon-gpu-object-")).map(e => ({ name: e.name, duration: e.duration })) });
      });
      const target = await context.newPage();
      target.on("pageerror", error => errors.push(error.message));
      let inputTimer;
      try {
        const cdp = await context.newCDPSession(target);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        // Playwright routing 会禁用 HTTP 缓存；冷/热加载阶段只屏蔽独立统计域，导航前再安装受控路由。
        await cdp.send("Network.setBlockedURLs", { urls: ["*cloudflareinsights.com*"] });
        let move = 0;
        inputTimer = setInterval(() => { void cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20 + move++ % 12,
          y: 15, timestamp: Date.now() / 1000 }).catch(() => {}); }, 32);
        const collect = () => target.evaluate(() => window.__collectComparison());
        await target.goto(origin);
        await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
        // 冷启动立刻提示再开盖，观察首个交互；之后真实 reload 复用当前上下文的资源缓存。
        await target.locator("#box-button").click();
        await target.waitForFunction(() => document.querySelector("#journey-choices").dataset.prompt !== "true");
        await target.locator("[data-entrance=blog]").evaluate(link => link.click());
        await target.waitForTimeout(1000);
        const cold = await collect();
        await target.reload();
        await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
        const warmReady = await target.evaluate(() => window.__comparison.ready);
        // 初始化专项复测仍覆盖冷启动首个提示与开盖，热加载停在就绪；完整旅程由默认模式独立验证。
        if (startupOnly) {
          const warm = await collect();
          if (cold.fallback || warm.fallback || errors.length) throw new Error(JSON.stringify({ variant, trial, errors }));
          samples.push({ trial, variant, cpu, mobile, cold: summarize(cold), warm: summarize(warm), warmReady, navigations: 0, errors });
          continue;
        }
        await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        clearInterval(inputTimer);
        await target.locator("[data-entrance=blog]").hover();
        await target.waitForTimeout(300);
        await target.locator("[data-entrance=world]").hover();
        await target.waitForTimeout(300);
        await target.locator("#box-button").click();
        inputTimer = setInterval(() => { void cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20 + move++ % 12,
          y: 15, timestamp: Date.now() / 1000 }).catch(() => {}); }, 32);
        await target.waitForFunction(() => document.querySelector("#journey-choices").dataset.prompt !== "true");
        const destination = await target.locator("[data-entrance=world]").getAttribute("href");
        let navigations = 0;
        await target.route(destination, async route => {
          navigations++;
          await route.fulfill({ contentType: "text/html", body: "<h1>Controlled performance target</h1>" });
        });
        await target.locator("[data-entrance=world] .entry-copy").click({ noWaitAfter: true });
        // 在黑场门禁仍阻止导航的实际帧内收集，禁止等请求开始后再 evaluate 旧文档形成互等。
        const warm = await target.evaluate(() => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("完整旅程没有呈现黑场")), 30000);
          const poll = () => {
            if (document.querySelector("#ink-transition")?.dataset.black === "true") {
              clearTimeout(timeout); resolve(window.__collectComparison());
            } else requestAnimationFrame(poll);
          };
          poll();
        }));
        await target.waitForURL(destination, { waitUntil: "domcontentloaded" });
        if (cold.fallback || warm.fallback || errors.length || navigations !== 1) throw new Error(JSON.stringify({ variant, trial, errors, navigations }));
        // 保留全部长任务与 P95/P99，不能仅以较快的中位数掩盖尾部或交互退化。
        samples.push({ trial, variant, cpu, mobile, cold: summarize(cold), warm: summarize(warm), warmReady, navigations, errors });
      } finally { clearInterval(inputTimer); await context.close(); }
    }
  }
  return { cpu, mobile, trials, startupOnly, samples, summary: ["before", "after"].map(variant => {
    const group = samples.filter(sample => sample.variant === variant);
    return { variant, coldReady: percentile(group.map(s => s.cold.ready)), warmReady: percentile(group.map(s => s.warmReady)),
      coldLoadingP95: percentile(group.map(s => s.cold.phases.loading.frames.p95)),
      warmLoadingP95: percentile(group.map(s => s.warm.phases.loading.frames.p95)) };
  }) };
}
