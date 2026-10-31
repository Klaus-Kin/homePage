// 在真实浏览器中逐帧查看开幕，暂停的动画和时钟仅存在于独立验收上下文，不修改页面实现。
async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser(), results = [];
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1024, height: 1366 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const context = await browser.newContext({ viewport });
    try {
      const target = await context.newPage(), errors = [];
      target.on("pageerror", (error) => errors.push(error.message));
      await target.clock.install();
      await target.addInitScript(() => {
        // 类名改变时立即暂停 CSS 动画，保证每个分辨率都能截取同一时刻的幕布边界。
        new MutationObserver(() => {
          const loader = document.querySelector("#moon-loader.revealing");
          if (loader && !window.__curtainReview) {
            window.__curtainReview = true;
            loader.getAnimations({ subtree: true }).forEach((animation) => animation.pause());
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
      });
      await target.goto(origin);
      await target.waitForFunction(() => window.__curtainReview);
      // 同时停住完成兜底定时器，截图耗时不会意外拆除幕布。
      await target.clock.pauseAt(new Date(Date.now() + 100));
      const frames = [];
      // 最后一帧停在结束前一毫秒，避免浏览器在截图期间自动派发 animationend。
      for (const time of [0, 225, 449]) {
        const frame = await target.evaluate((time) => {
          const loader = document.querySelector("#moon-loader");
          loader.getAnimations({ subtree: true }).forEach((animation) => { animation.currentTime = time; });
          const app = document.querySelector("#app");
          return {
            time, state: app.dataset.state, inert: app.inert,
            sceneVisible: document.querySelector("#scene").checkVisibility({ checkVisibilityCSS: true }),
            left: loader.querySelector(".loader-curtain-left").getBoundingClientRect().toJSON(),
            right: loader.querySelector(".loader-curtain-right").getBoundingClientRect().toJSON(),
            labelOpacity: getComputedStyle(loader.querySelector(".loading-label")).opacity,
          };
        }, time);
        if (!frame.inert || frame.state !== "loading" || !frame.sceneVisible)
          throw new Error(`幕布后的场景或交互门禁错误：${JSON.stringify(frame)}`);
        if (time === 0 && (frame.left.right < viewport.width / 2 || frame.right.left > viewport.width / 2))
          throw new Error("初始幕布存在中缝");
        if (time === 225 && (Math.abs(frame.left.right - viewport.width / 4) > 2 || Math.abs(frame.right.left - viewport.width * .75) > 2))
          throw new Error("左右幕布没有对称拉开");
        if (time === 449 && (frame.left.right > .1 || frame.right.left < viewport.width - .1 || frame.labelOpacity !== "0"))
          throw new Error("幕布未完全离场或欢迎语仍可见");
        await target.screenshot({ path: `output/playwright/curtain-${viewport.width}-${time}.png` });
        frames.push(frame);
      }
      await target.keyboard.press("Tab");
      if (await target.evaluate(() => document.querySelector("#app").contains(document.activeElement)))
        throw new Error("开幕过程中可以通过键盘进入主页");
      // 模拟动画事件被浏览器取消，确认兜底会释放幕布与交互锁。
      await target.clock.runFor(600);
      const finished = await target.evaluate(() => ({
        state: document.querySelector("#app").dataset.state,
        inert: document.querySelector("#app").inert,
        loader: !!document.querySelector("#moon-loader"),
      }));
      if (finished.state !== "idle" || finished.inert || finished.loader || errors.length)
        throw new Error(`开幕后没有恢复主页：${JSON.stringify({ finished, errors })}`);
      // 保存最终交付画面，与过程中间帧一起检查首帧覆盖和短屏构图。
      await target.screenshot({ path: `output/playwright/startup-final-${viewport.width}x${viewport.height}.png` });
      results.push({ viewport, frames, timerRecovery: true, errors });
    } finally { await context.close(); }
  }
  // 独立检查自然播放完成、减少动态、转场中旋转屏幕及切换动态偏好。
  for (const scenario of ["natural", "reduced", "resize", "motion-change", "pagehide"]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 },
      reducedMotion: scenario === "reduced" ? "reduce" : "no-preference" });
    try {
      const target = await context.newPage();
      await target.addInitScript(() => {
        new MutationObserver(() => {
          const loader = document.querySelector("#moon-loader.revealing");
          if (loader && !window.__revealStarted) {
            window.__revealStarted = performance.now();
            window.__revealAnimations = loader.getAnimations({ subtree: true })
              .map((animation) => animation.animationName).filter(Boolean);
          }
          if (window.__revealStarted && !document.querySelector("#moon-loader") && !window.__revealDuration)
            window.__revealDuration = performance.now() - window.__revealStarted;
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
      });
      await target.goto(origin);
      await target.waitForFunction(() => window.__revealStarted);
      if (scenario === "resize") await target.setViewportSize({ width: 390, height: 844 });
      if (scenario === "motion-change") await target.emulateMedia({ reducedMotion: "reduce" });
      if (scenario === "pagehide") await target.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
      await target.waitForFunction(() => !document.querySelector("#moon-loader") && !document.querySelector("#app").inert);
      if (scenario !== "pagehide") await target.waitForSelector('#app[data-state="idle"]');
      const state = await target.evaluate(() => ({ duration: window.__revealDuration, animations: window.__revealAnimations }));
      if (scenario === "natural" && (state.duration < 400 || state.duration > 800)) throw new Error("自然开幕时长异常");
      if (scenario === "reduced" && (state.duration < 100 || state.duration > 500 ||
          !state.animations.includes("loader-fade-out") || state.animations.some((name) => name.startsWith("curtain-open"))))
        throw new Error("减少动态模式仍然横向拉开幕布");
      results.push({ scenario, ...state });
    } finally { await context.close(); }
  }
  return results;
}
