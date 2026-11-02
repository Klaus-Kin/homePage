// 连续采样近景到展开的镜头轨迹：起始帧不能跳变，中途不能阈值突跳或反复摆动，模型始终完整可见。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin, results = [];
  for (const [width, height] of [[360, 800], [390, 844], [393, 852], [430, 932], [480, 1040]]) {
    const context = await page.context().browser().newContext({
      viewport: { width, height }, isMobile: true, hasTouch: true,
    });
    try {
      const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; });
      // 中止未受控的外部请求，短时采样也不能意外导航到真实站点。
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]');
      // 启动使用真实调度；就绪后才冻结交互时钟，避免慢首帧把揭幕永久暂停。
      await target.clock.install();
      await target.clock.pauseAt(new Date(Date.now() + 100));
      await target.clock.runFor(32);
      const sample = () => target.locator('#scene').evaluate(el => ({
        angle: +el.dataset.lidAngle,
        hinge: JSON.parse(el.dataset.chestPath).hinge,
        bounds: JSON.parse(el.dataset.boxBounds),
      }));
      const idle = await sample(), frames = [idle];
      await target.locator('[data-entrance=blog]').tap();
      for (let frame = 1; frame <= 53; frame++) {
        await target.clock.runFor(16);
        frames.push(await sample());
        if (width === 390 && frame % 4 === 0)
          await target.screenshot({path: `output/playwright/opening-stability-${String(frame).padStart(2, '0')}.png`});
      }
      const drift = Math.max(...frames.map(f => Math.hypot(f.hinge.x - idle.hinge.x, f.hinge.y - idle.hinge.y)));
      const steps = frames.slice(1).map((f,i) => Math.hypot(f.hinge.x-frames[i].hinge.x,f.hinge.y-frames[i].hinge.y));
      const startDrift = Math.max(...frames.slice(0,4).map(f => Math.hypot(f.hinge.x-idle.hinge.x,f.hinge.y-idle.hinge.y)));
      const direction = Math.sign(frames.at(-1).hinge.x-idle.hinge.x);
      const monotonic = frames.slice(1).every((f,i) => (f.hinge.x-frames[i].hinge.x)*direction >= -.001);
      const visible = frames.every(f => f.bounds.left >= 11.8 && f.bounds.right <= width - 11.8 && f.bounds.top >= 0 && f.bounds.bottom <= height);
      results.push({width, height, drift, startDrift, maxStep:Math.max(...steps), monotonic, visible, frames});
      if (startDrift > .2 || Math.max(...steps) > drift*.09+.1 || !monotonic || !visible || frames.at(-1).angle !== 180)
        throw new Error(`开盖镜头存在突跳、摆动或出画：${JSON.stringify(results)}`);
    } finally { await context.close(); }
  }
  return results;
}
