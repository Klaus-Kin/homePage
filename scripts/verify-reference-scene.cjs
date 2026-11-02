// 通过 playwright-cli run-code --filename 执行；同一脚本记录修改前后取景和真实渲染开销。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin;
  const phase = new URL(page.url()).searchParams.get("phase") || "after";
  const results = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [[1672,941],[1920,1080],[768,1024],[390,844],[320,480],[844,390]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
    if (await page.locator('#app').evaluate(el => el.classList.contains('fallback'))) throw new Error('场景意外降级');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `output/playwright/${phase}-${width}x${height}.png` });
    // 截取元素仍会包含覆盖在其上的 HTML，场景图必须显式隐藏正文与鼠标层。
    const hidden = await page.addStyleTag({content:'.fade-content,.staff-cursor-layer,#box-button {visibility:hidden!important}'});
    await page.locator('#scene canvas').screenshot({ path: `output/playwright/${phase}-scene-${width}x${height}.png` });
    await hidden.evaluate(el => el.remove());
    const geometry = await page.evaluate(() => {
      const scene = document.querySelector('#scene');
      const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
      return { box: JSON.parse(scene.dataset.boxBounds), moon: JSON.parse(scene.dataset.moonBounds),
        resources: JSON.parse(scene.dataset.resources), layout: scene.dataset.layout,
        scroll: document.documentElement.scrollWidth > innerWidth,
        hits: [...document.querySelectorAll('[data-entrance],#box-button')].map(rect) };
    });
    // 只测主场景动画稳定后的帧间隔；浏览器模拟数据不能代替真机性能。
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(200);
    const frames = await page.evaluate(() => new Promise(resolve => {
      const gaps = []; let previous;
      function sample(now) { if (previous) gaps.push(now-previous); previous=now;
        if(gaps.length<45) requestAnimationFrame(sample); else resolve(gaps); }
      requestAnimationFrame(sample);
    }));
    const sorted = frames.slice().sort((a,b)=>a-b);
    const b = geometry.box;
    if (geometry.scroll || b.left < 0 || b.top < 0 || b.right > width || b.bottom > height)
      throw new Error(`主体出界 ${width}x${height}: ${JSON.stringify(geometry)}`);
    if (geometry.hits.some(r => r.width < 44 || r.height < 44)) throw new Error('触控区域不足 44px');
    results.push({ width, height, ...geometry, frameMedian:sorted[22], frameP95:sorted[42] });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return results;
}
