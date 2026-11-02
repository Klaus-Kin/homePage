// 验证环境动画生命周期，并连续记录流星三个时刻；不向生产场景注入测试控制接口。
async (page) => {
  // 后台与减少动态检查依赖诊断帧计数，不能把两个 null 当作已经停止渲染。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(origin);
  await page.waitForFunction(
    () => document.querySelector("#app").dataset.state === "idle",
  );
  const frames = () => page.locator("#scene").getAttribute("data-frames");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const reducedStart = await frames();
  await page.waitForTimeout(250);
  if ((await frames()) !== reducedStart)
    throw new Error("减少动态时仍在连续渲染");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(100);
  if ((await frames()) === reducedStart)
    throw new Error("恢复动态后未恢复渲染");
  // 浏览器可见性事件以相同代码路径触发，记录渲染计数来验证后台停止。
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenStart = await frames();
  await page.waitForTimeout(250);
  if ((await frames()) !== hiddenStart) throw new Error("后台仍在渲染");
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);
  if ((await frames()) === hiddenStart) throw new Error("回到前台后未恢复渲染");

  const context = await page
    .context()
    .browser()
    .newContext({ viewport: { width: 1366, height: 768 } });
  const target = await context.newPage();
  await context.addInitScript(() => { window.__moonDiagnostics = true; });
  // 中止未受控的外部请求，短时采样也不能意外导航到真实站点。
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  // 虚拟时钟只控制真实 requestAnimationFrame，位移和朝向仍由生产算法生成。
  await target.goto(origin);
  await target.waitForSelector('#app[data-state="idle"]');
  // 启动使用真实调度；就绪后才冻结交互时钟，避免慢首帧把揭幕永久暂停。
  await target.clock.install();
  await target.clock.pauseAt(new Date(Date.now() + 100));
  await target.clock.runFor(1400);
  for (let i = 0; i < 3; i++) {
    await target.screenshot({ path: `output/playwright/meteor-${i}.png` });
    await target.clock.runFor(180);
  }
  // 相隔一分钟的月云截图用于确认云移动独立于月面。
  await target.emulateMedia({ reducedMotion: "reduce" });
  await target.screenshot({ path: "output/playwright/moon-still.png" });
  await target.emulateMedia({ reducedMotion: "no-preference" });
  await target.clock.runFor(60000);
  await target.screenshot({ path: "output/playwright/moon-clouds-later.png" });
  await context.close();
  return {
    reducedMotionStopsRendering: true,
    hiddenStopsRendering: true,
    resumes: true,
    meteorFrames: 3,
  };
}
