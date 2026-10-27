// 录制真实时间的桌面和手机画面，验证云雾几秒内可见的运动与场景暂停恢复。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin;
  const results = [];
  for (const [name, width, height] of [["desktop", 1366, 768], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height },
      isMobile: name === "mobile", hasTouch: name === "mobile" });
    const target = await context.newPage(), errors = [];
    target.on("pageerror", (error) => errors.push(error.message));
    try {
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]');
      const frames = () => target.locator("#scene").getAttribute("data-frames");
      // 使用现有系统编码器压制截图序列，无需安装 Playwright 的额外全局视频组件。
      const start = Date.now();
      for (let frame = 0; frame <= 40; frame++) {
        await target.waitForTimeout(Math.max(1, start + frame * 200 - Date.now()));
        await target.screenshot({ path: `output/playwright/cloud-${name}-frame-${String(frame).padStart(3, "0")}.png` });
        if (frame % 20 === 0) await target.screenshot({ path: `output/playwright/cloud-${name}-${frame / 5}.png` });
      }
      await target.emulateMedia({ reducedMotion: "reduce" });
      await target.waitForTimeout(100);
      const reduced = await frames();
      await target.waitForTimeout(400);
      if (reduced !== await frames()) throw new Error("减少动态时场景仍运动");
      await target.emulateMedia({ reducedMotion: "no-preference" });
      await target.waitForTimeout(120);
      if (reduced === await frames()) throw new Error("恢复动态后场景未恢复");
      // 与真实 visibilitychange 使用同一路径；后台没有渲染，也不累计云雾时间。
      await target.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const hidden = await frames();
      await target.waitForTimeout(400);
      if (hidden !== await frames()) throw new Error("后台仍在渲染");
      await target.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
      await target.waitForTimeout(150);
      if (hidden === await frames()) throw new Error("回到前台未恢复");
      if (errors.length) throw new Error(errors.join("\n"));
      results.push({ name, reducedAndBackgroundPause: true, frames: 41, elapsedMs: Date.now() - start });
    } finally { await context.close(); }
  }
  // 减少动态时慢入口仍提供静止金箍与文字提示，成功退出不会留下覆盖层。
  const context = await browser.newContext({ reducedMotion: "reduce" });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    const target = await context.newPage();
    await target.route(/\/(?:src\/main\.ts|assets\/index-[^/]+\.js)(?:\?|$)/, async (route) => {
      await gate; await route.continue();
    });
    await target.goto(origin, { waitUntil: "commit" });
    await target.locator("#moon-loader").waitFor();
    const loading = await target.locator("#moon-loader").evaluate((el) => ({
      animation: getComputedStyle(el.querySelector("svg")).animationName,
      label: el.querySelector(".loading-label").getBoundingClientRect().width,
    }));
    if (loading.animation !== "none" || loading.label < 50) throw new Error("减少动态加载提示错误");
    await target.screenshot({ path: "output/playwright/loading-reduced.png" });
    release();
    await target.waitForSelector('#app[data-state="idle"]');
    if (await target.locator("#moon-loader").count()) throw new Error("减少动态加载层未退出");
    results.push({ reducedLoader: loading });
  } finally { release(); await context.close(); }
  return results;
}
