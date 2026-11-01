// 开发服务器上通过 playwright-cli run-code --filename 执行：检查月夜素材、同步浮动及放大后的羽片和红丝。
async (page) => {
  const origin = new URL(page.url()).origin, browser = page.context().browser(), results = [];
  for (const [width, height] of [[1920, 1080], [390, 844], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    try {
      const target = await context.newPage(), errors = [];
      target.on('pageerror', error => errors.push(error.message));
      await target.goto(origin);
      await target.waitForSelector('#app[data-state=idle]:not([inert])');
      await target.waitForFunction(() => document.querySelectorAll('.entry-icon[data-model-ready=true]').length === 2);
      await target.mouse.move(width - 5, 5);
      await target.screenshot({ path: `output/playwright/night-${width}x${height}-rest.png` });
      await target.keyboard.press('Tab');
      await target.locator('[data-entrance=world]').focus();
      await target.locator('[data-entrance=blog]').hover();
      await target.waitForTimeout(1500);
      await target.screenshot({ path: `output/playwright/night-${width}x${height}-active.png` });
      // 连续截图使用真实键盘焦点保持冠饰激活，使录制独立于采集期间的指针位置。
      await target.locator('[data-entrance=blog]').focus();
      await target.mouse.move(width - 5, 5);
      const samples = [];
      const box = await target.locator('#journey-choices').boundingBox();
      for (let i = 0; i < 28; i++) {
        samples.push(await target.locator('[data-entrance=blog]').evaluate(link => ({
          copy: link.querySelector('.entry-copy').style.transform,
          icon: link.querySelector('.entry-icon').style.transform,
        })));
        if (width === 1920) await target.screenshot({ path: `output/playwright/night-motion-${String(i).padStart(2, '0')}.png`,
          clip: { x: Math.max(0, box.x - 20), y: box.y - 22, width: box.width + 40, height: box.height + 44 } });
        await target.waitForTimeout(120);
      }
      if (samples.some(sample => sample.copy !== sample.icon) || new Set(samples.map(sample => sample.copy)).size < 15)
        throw new Error(`冠座没有随文案持续同步浮动：${JSON.stringify({ width, height, samples })}`);
      if (errors.length) throw new Error(JSON.stringify(errors));
      results.push({ viewport: [width, height], synchronizedFrames: samples.length, errors });
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ viewport: { width: 1120, height: 440 }, deviceScaleFactor: 1 });
  try {
    const target = await context.newPage();
    await target.route('**/__night-atlas', route => route.fulfill({ contentType: 'text/html', body:
      '<style>body{margin:0;padding:24px;background:#152238;color:#c9c9bc;font:14px sans-serif}main{display:flex;gap:16px}figure{margin:0}canvas{display:block;width:248px;height:248px}figcaption{text-align:center;margin-top:20px}</style><main></main>' }));
    await target.goto(origin + '/__night-atlas');
    const data = await target.evaluate(async () => {
      const { createEntryArtwork } = await import('/src/entry-artwork.ts');
      const { Initialization } = await import('/src/scene/initialization.ts');
      const { createEntryRenderer, createEntryScene } = await import('/src/entry-rendering.ts');
      const results = [];
      for (const [kind, time, active] of [['crown', 0, 0], ['crown', 1673, 1], ['crown', 4900, 1], ['monkey', 1800, 1]]) {
        const init = new Initialization(), model = await createEntryArtwork(kind, init);
        const canvas = document.createElement('canvas'), renderer = createEntryRenderer(canvas);
        try {
          renderer.setSize(248, 248, false);
          const { scene, camera } = createEntryScene(model);
          model.update(time, active, active, active);
          renderer.render(scene, camera);
          const image = new Image(); image.src = canvas.toDataURL(); await image.decode();
          const pixels = document.createElement('canvas'); pixels.width = pixels.height = 248;
          const ctx = pixels.getContext('2d'); ctx.drawImage(image, 0, 0);
          const rgba = ctx.getImageData(0, 0, 248, 248).data;
          let edge = 0;
          for (let y = 0; y < 248; y++) for (let x = 0; x < 248; x++)
            if ((x < 2 || x > 245 || y < 2 || y > 245) && rgba[(y * 248 + x) * 4 + 3] > 20) edge++;
          if (edge) throw new Error(`${kind} 动效被画布边缘裁切：${edge}`);
          const figure = document.createElement('figure'), caption = document.createElement('figcaption');
          caption.textContent = `${kind} · ${time}ms`;
          figure.append(image, caption); document.querySelector('main').append(figure);
          results.push({ kind, time, edgePixels: edge });
        } finally { renderer.dispose(); renderer.forceContextLoss(); init.dispose(); }
      }
      return results;
    });
    await target.screenshot({ path: 'output/playwright/night-artwork-atlas.png' });
    results.push({ atlas: data });
  } finally { await context.close(); }
  return results;
}
