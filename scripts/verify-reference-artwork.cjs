// 通过 playwright-cli run-code --filename 执行；生产预览可用，检查真实图标、命中区域、边缘裁切和降级。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  for (const [width, height] of [[1920, 1080], [390, 844], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    try {
      const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; }), errors = [];
      target.on('pageerror', error => errors.push(error.message));
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.waitForFunction(() => document.querySelectorAll('.entry-icon[data-model-ready=true]').length === 2);
      await target.mouse.move(width - 10, 10);
      await target.screenshot({ path: `output/playwright/reference-${width}x${height}.png` });
      const state = () => target.locator('.staff-cursor-layer').getAttribute('data-cursor-kind');
      if (width === 1920) {
        assert(await state() === 'staff', '空白处未显示金箍棒');
        for (const entrance of ['blog', 'world']) for (const part of ['.entry-icon', '.entry-copy']) {
          const bounds = await target.locator(`[data-entrance=${entrance}] ${part}`).boundingBox();
          await target.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          assert(await state() === 'point', `${entrance} ${part} 未显示手指`);
          await target.waitForTimeout(950);
          assert(await target.locator(`[data-entrance=${entrance}]`).getAttribute('data-entry-active') === 'true', '原悬停动效未激活');
          await target.screenshot({ path: `output/playwright/reference-${entrance}-${part.slice(1)}.png` });
          await target.mouse.move(700, 100);
          assert(await state() === 'staff', '移出入口没有恢复金箍棒');
        }
        const chest = await target.locator('#box-button').boundingBox();
        await target.mouse.move(chest.x + chest.width / 2, chest.y + chest.height / 2);
        assert(await state() === 'grab', '宝盒上未显示抓取手');
        await target.screenshot({ path: 'output/playwright/reference-chest-grab.png' });
        // 完整点击宝盒确认透明鼠标层不会截断原有的选择提示。
        await target.mouse.click(chest.x + chest.width / 2, chest.y + chest.height / 2);
        assert(await target.locator('#app').getAttribute('data-state') === 'idle', '宝盒误触发导航');
        await target.waitForTimeout(1900);
        for (const [x, y] of [[0, 0], [1919, 0], [0, 1079], [1919, 1079]]) {
          await target.mouse.move(x, y);
          const edge = await target.locator('.staff-cursor-layer').evaluate(layer => ({
            hidden: layer.hidden, overflow: getComputedStyle(layer).overflow,
            pointerEvents: getComputedStyle(layer).pointerEvents,
            width: layer.querySelector('img').getBoundingClientRect().width,
            scroll: document.documentElement.scrollWidth > innerWidth,
          }));
          assert(!edge.hidden && edge.overflow === 'hidden' && edge.pointerEvents === 'none' && edge.width === 72 && !edge.scroll,
            `边缘裁切或点击透传回归：${JSON.stringify(edge)}`);
        }
      }
      await target.emulateMedia({ reducedMotion: 'reduce' });
      await target.locator('[data-entrance=world]').focus();
      await target.waitForTimeout(1400);
      const before = await target.locator('.entry-icon').evaluateAll(slots => slots.map(slot => slot.dataset.frames));
      await target.waitForTimeout(250);
      const after = await target.locator('.entry-icon').evaluateAll(slots => slots.map(slot => slot.dataset.frames));
      assert(JSON.stringify(before) === JSON.stringify(after), '减少动态后仍循环绘制');
      assert(!errors.length, JSON.stringify(errors));
      results.push({ viewport: [width, height], artworkReady: true, errors });
    } finally { await context.close(); }
  }
  for (const mode of ['no-script', 'icon-context-loss', 'texture-failure', 'cursor-failure', 'touch']) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 },
      javaScriptEnabled: mode !== 'no-script', hasTouch: mode === 'touch', isMobile: mode === 'touch',
      reducedMotion: 'reduce' });
    try {
      const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; });
      if (mode === 'texture-failure') await target.route('**/entry-monkey-artwork.png', route => route.abort());
      if (mode === 'cursor-failure') await target.route('**/cursor-*.png', route => route.abort());
      await target.goto(origin);
      if (mode !== 'no-script') await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      if (mode === 'icon-context-loss') {
        await target.waitForFunction(() => document.querySelectorAll('.entry-icon[data-model-ready=true]').length === 2);
        await target.locator('[data-entrance=world] canvas').evaluate(canvas =>
          canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
        await target.waitForFunction(() => !document.querySelector('[data-entrance=world] canvas'));
      }
      if (['no-script', 'icon-context-loss', 'texture-failure'].includes(mode)) {
        const fallback = target.locator('[data-entrance=world] .monkey-face');
        await fallback.waitFor({ state: 'visible' });
        assert(await fallback.evaluate(image => image.complete && image.naturalWidth > 0), '参考图后备加载失败');
      }
      if (mode === 'cursor-failure' || mode === 'touch') {
        await target.mouse.move(700, 100);
        assert(await target.locator('.staff-cursor-layer').evaluate(layer => layer.hidden), '鼠标失败或触屏仍隐藏系统指针');
        assert(await target.locator('html').evaluate(root => getComputedStyle(root).cursor !== 'none'), '原生回退不可见');
      }
      await target.screenshot({ path: `output/playwright/reference-${mode}.png` });
      results.push({ mode, passed: true });
    } finally { await context.close(); }
  }
  return results;
}
