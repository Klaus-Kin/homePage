// 固定铰链应始终停在同一屏幕坐标；连续采样可捕获只比较首尾截图会遗漏的取景跳动。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const [width, height] of [[360, 800], [390, 844], [430, 932]]) {
    const context = await page.context().browser().newContext({
      viewport: { width, height }, isMobile: true, hasTouch: true,
    });
    try {
      const target = await context.newPage();
      await target.clock.install();
      await target.clock.pauseAt(new Date(Date.now() + 1000));
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]');
      await target.clock.runFor(32);
      const sample = () => target.locator('#scene').evaluate(el => ({
        angle: +el.dataset.lidAngle,
        hinge: JSON.parse(el.dataset.chestPath).hinge,
        bounds: JSON.parse(el.dataset.boxBounds),
      }));
      const idle = await sample(), frames = [idle];
      await target.locator('#box-button').tap();
      for (let frame = 1; frame <= 53; frame++) {
        await target.clock.runFor(16);
        frames.push(await sample());
        if (width === 390 && frame % 4 === 0)
          await target.screenshot({path: `output/playwright/opening-stability-${String(frame).padStart(2, '0')}.png`});
      }
      const drift = Math.max(...frames.map(f => Math.hypot(f.hinge.x - idle.hinge.x, f.hinge.y - idle.hinge.y)));
      const visible = frames.every(f => f.bounds.left >= 11.8 && f.bounds.right <= width - 11.8 && f.bounds.top >= 0 && f.bounds.bottom <= height);
      results.push({width, height, drift, visible, frames});
      if (drift > .1 || !visible) throw new Error(`开盖时固定铰链漂移或出画：${JSON.stringify(results)}`);
    } finally { await context.close(); }
  }
  return results;
}
