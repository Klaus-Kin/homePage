// 在各类视口逐段验证真实上翻动画，覆盖竖直抬升中途与完全落到左侧时的投影范围。
async (page) => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext();
  const results = [];
  try {
    const target = await context.newPage();
    // 中止未受控的外部请求，短时采样也不能意外导航到真实站点。
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const [width, height] of [
      [1920,1080],[1366,768],[768,1024],[1024,1366],[1280,1600],
      [1440,1920],[1024,1024],[1280,1024],[1366,1024],
      [360,800],[390,844],[430,932],[844,390],
    ]) {
      await target.setViewportSize({ width, height });
      // 同一标签页复用时先解除上一轮暂停，让新文档仍能完成启动和揭幕。
      await target.clock.resume();
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]');
      // 启动使用真实调度；就绪后才冻结交互时钟，避免慢首帧把揭幕永久暂停。
      await target.clock.install();
      await target.clock.pauseAt(new Date(Date.now() + 100));
      await target.clock.runFor(32);
      // 使用真实几何端点检查屏幕中的摆放和弧线，而不只检查归一化角度。
      const idle = await target.locator("#scene").evaluate(el => ({
        angle: +el.dataset.lidAngle, path: JSON.parse(el.dataset.chestPath),
      }));
      if (idle.angle !== 0 || idle.path.tip.x <= idle.path.hinge.x ||
          Math.abs(idle.path.tip.y - idle.path.hinge.y) > 0.4 * (idle.path.tip.x - idle.path.hinge.x))
        throw new Error(`${width}x${height}: 待机未闭合、长边未横放或铰链未在左端 ${JSON.stringify(idle)}`);
      await target.locator("[data-entrance=blog]").focus();
      await target.keyboard.press("Enter");
      let samples = 0;
      for (let step = 0; step < 11; step++) {
        await target.clock.runFor(80);
        const data = await target.evaluate(() => {
          const host = document.querySelector("#scene");
          return { bounds: JSON.parse(host.dataset.boxBounds),
            rotation: JSON.parse(host.dataset.openingRotation),
            height: JSON.parse(host.dataset.chestHeight),
            angle: +host.dataset.lidAngle,
            path: JSON.parse(host.dataset.chestPath) };
        });
        const b = data.bounds;
        if (b.left < 0 || b.top < 0 || b.right > width || b.bottom > height ||
            data.rotation[0] !== 0 || data.rotation[1] !== 0 ||
            Math.abs(data.path.tipWorldZ - idle.path.tipWorldZ) > 1e-8)
          throw new Error(`${width}x${height} step ${step}: ${JSON.stringify(data)}`);
        // 屏幕向上与世界高度抬升同时成立；纵深不变，禁止改成朝镜头的水平旋开。
        if (data.angle > 50 && data.angle < 130 &&
            (data.path.tip.y >= data.path.hinge.y || data.path.tipWorldY <= data.path.hingeWorldY + 1))
          throw new Error(`${width}x${height}: 上盖未真正抬离地面 ${JSON.stringify(data)}`);
        if (data.angle === 180 && data.path.tip.x >= data.path.hinge.x)
          throw new Error(`${width}x${height}: 展开终点未到转轴左侧 ${JSON.stringify(data)}`);
        samples++;
      }
      results.push({ width, height, samples, verticalOpeningAndVisible: true });
    }
  } finally { await context.close(); }
  return results;
}
