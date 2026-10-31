// 通过 playwright-cli run-code --filename 执行；在生产预览中复现第三方脚本失败、慢首开和真正入口失败。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  for (const scenario of ["analytics", "entry-failed", "moon-failed", "slow-moon", "phone-cold"]) {
    const phone = scenario === "phone-cold";
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 768 },
      isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, reducedMotion: "no-preference" });
    const target = await context.newPage(), errors = [];
    target.setDefaultTimeout(30000);
    target.on("pageerror", error => errors.push(error.message));
    try {
      if (phone) {
        const cdp = await context.newCDPSession(target);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      await target.addInitScript(() => {
        window.__bootReview = { reveals: [], stages: [], ready: 0 };
        let previousStage;
        new MutationObserver(() => {
          const loader = document.querySelector("#moon-loader.revealing"), app = document.querySelector("#app");
          if (loader && !window.__bootReview.reveals.length) window.__bootReview.reveals.push({ time: performance.now(),
            inert: app.inert, animations: loader.getAnimations({ subtree: true }).map(animation => animation.animationName).filter(Boolean) });
          if (app?.dataset.bootStage && app.dataset.bootStage !== previousStage) {
            previousStage = app.dataset.bootStage;
            window.__bootReview.stages.push(previousStage);
          }
          if (app?.dataset.state === "idle" && !loader && !window.__bootReview.ready) window.__bootReview.ready = performance.now();
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-state", "data-boot-stage"] });
      });
      if (scenario === "analytics") {
        await target.route(origin + "/", async route => {
          const response = await route.fetch();
          await route.fulfill({ response, body: (await response.text()).replace("</body>",
            '<script type="module" src="https://analytics.invalid/beacon.js"></script></body>') });
        });
        await target.route("https://analytics.invalid/**", route => route.abort());
      }
      if (scenario === "entry-failed") await target.route(/\/assets\/index-[^/]+\.js$/, route => route.abort());
      if (scenario === "moon-failed") await target.route("**/assets/moon-lroc.jpg", route => route.abort());
      if (scenario === "slow-moon") await target.route("**/assets/moon-lroc.jpg", async route => {
        await new Promise(resolve => setTimeout(resolve, 11000));
        await route.continue();
      });
      await target.goto(origin, { waitUntil: "domcontentloaded" });
      await target.bringToFront();
      await target.waitForFunction(() => document.querySelector("#app")?.dataset.state === "idle" && !document.querySelector("#moon-loader"));
      const state = await target.evaluate(() => ({ ...window.__bootReview, failed: window.__moonBoot.failed,
        fallback: document.querySelector("#app").classList.contains("fallback"), inert: document.querySelector("#app").inert }));
      const expectedFallback = ["entry-failed", "moon-failed"].includes(scenario);
      if (state.fallback !== expectedFallback || state.failed !== (scenario === "entry-failed") || state.inert || errors.length)
        throw new Error(JSON.stringify({ scenario, state, errors }));
      if (state.reveals.length !== 1 || !state.reveals[0].inert || !state.reveals[0].animations.includes("curtain-open-right"))
        throw new Error(`首开没有经过拉幕：${JSON.stringify({ scenario, state })}`);
      if (phone) await target.screenshot({ path: "output/playwright/lifecycle-phone-cold-idle.png" });
      results.push({ scenario, ...state, errors });
    } finally { await context.close(); }
  }
  return results;
}
