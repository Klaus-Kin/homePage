// 通过 Playwright CLI 执行：检查真实点击区域、临界尺寸和系统高对比度调色板，不依赖 CSS 字符串断言。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin;
  const failures = [], results = [];
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const target = await context.newPage(), fonts = [];
  target.on("request", request => { if (request.resourceType() === "font") fonts.push(request.url()); });

  // 检查整个宝盒按钮的网格采样，避免只测中心点而漏掉入口盖住按钮边缘的回归。
  async function inspectLayout(target, button = "#box-button") {
    return target.evaluate(selector => {
      const link = document.querySelector(".journey-link").getBoundingClientRect();
      const box = document.querySelector(selector).getBoundingClientRect();
      const overlap = Math.max(0, Math.min(link.right, box.right) - Math.max(link.left, box.left)) *
        Math.max(0, Math.min(link.bottom, box.bottom) - Math.max(link.top, box.top));
      const blocked = [];
      for (const x of [.1, .3, .5, .7, .9]) for (const y of [.1, .5, .9]) {
        const px = box.left + box.width * x, py = box.top + box.height * y;
        if (!document.elementFromPoint(px, py)?.matches(selector)) blocked.push({ x: px, y: py });
      }
      // 同时覆盖强制颜色下展开的原生文字，避免仅验证隐藏的 SVG 而漏掉换行溢出。
      const rows = [...document.querySelectorAll(".description .calligraphy-copy,.journey-link .calligraphy-copy,.description .calligraphy-text,.journey-link .calligraphy-text")]
        .filter(node => getComputedStyle(node).display !== "none" &&
          (!node.classList.contains("calligraphy-text") || getComputedStyle(node).position === "static"))
        .map(node => node.getBoundingClientRect().toJSON());
      return { overlap, blocked, link: link.toJSON(), box: box.toJSON(), rows,
        point: document.elementFromPoint(280, 435)?.id,
        clipped: link.left < 0 || link.right > innerWidth || link.bottom > innerHeight ||
          rows.some(row => row.left < 0 || row.right > innerWidth || row.bottom > innerHeight) };
    }, button);
  }

  try {
    await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
    const viewports = [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 480 },
      { width: 1100, height: 1000 }, { width: 2560, height: 1080 }];
    for (const width of [320, 375, 500, 600, 640, 667, 767, 768, 1024])
      for (const height of [499, 500, 501, 550, 600, 601]) viewports.push({ width, height });
    for (const viewport of viewports) {
      await target.setViewportSize(viewport); await target.waitForTimeout(100);
      const layout = await inspectLayout(target);
      if (layout.overlap || layout.blocked.length || layout.clipped) failures.push({ kind: "layout", viewport, layout });
      if (["1366x768", "390x844", "640x500", "320x500"].includes(`${viewport.width}x${viewport.height}`))
        await target.screenshot({ path: `output/playwright/calligraphy-layout-${viewport.width}-${viewport.height}.png` });
    }
    results.push({ layouts: viewports.length });

    for (const colorScheme of ["light", "dark"]) {
      await target.setViewportSize({ width: 640, height: 500 });
      await target.emulateMedia({ forcedColors: "active", colorScheme }); await target.waitForTimeout(100);
      const palette = await target.evaluate(() => {
        const probe = document.createElement("span"); document.body.append(probe);
        const systemColor = color => { probe.style.color = color; return getComputedStyle(probe).color; };
        const colors = { canvas: systemColor("Canvas"), text: systemColor("CanvasText"), link: systemColor("LinkText") };
        probe.remove();
        const natives = [...document.querySelectorAll(".description .calligraphy-text,.journey-link .calligraphy-text")].map(span => {
          const style = getComputedStyle(span), rect = span.getBoundingClientRect();
          return { color: style.color, background: style.backgroundColor, position: style.position, width: rect.width,
            link: !!span.closest(".journey-link"), text: span.textContent };
        });
        return { colors, natives, svgVisible: [...document.querySelectorAll(".calligraphy-copy")].some(svg => getComputedStyle(svg).display !== "none") };
      });
      if (palette.natives.length !== 7 || palette.svgVisible || palette.natives.some(span => span.position !== "static" ||
          span.width < 20 || span.background !== palette.colors.canvas || span.color !== (span.link ? palette.colors.link : palette.colors.text)))
        failures.push({ kind: "forced-colors", colorScheme, palette });
      await target.screenshot({ path: `output/playwright/calligraphy-forced-${colorScheme}.png` });
      for (const viewport of [{ width: 640, height: 500 }, { width: 320, height: 480 }, { width: 320, height: 500 },
        { width: 390, height: 844 }, { width: 640, height: 600 }, { width: 1100, height: 1000 }]) {
        await target.setViewportSize(viewport); await target.waitForTimeout(100);
        const layout = await inspectLayout(target);
        if (layout.overlap || layout.blocked.length || layout.clipped) failures.push({ kind: "forced-layout", colorScheme, viewport, layout });
      }
      results.push({ colorScheme, palette });
    }
    // 运行中关闭高对比度必须恢复行书，不能留下两份可见文字或新增字体请求。
    await target.emulateMedia({ forcedColors: "none", colorScheme: "dark" });
    const restored = await target.evaluate(() => ({
      svg: [...document.querySelectorAll(".calligraphy-copy")].every(svg => getComputedStyle(svg).display !== "none"),
      native: [...document.querySelectorAll(".calligraphy-text")].every(span => getComputedStyle(span).position === "absolute"),
      colors: [...document.querySelectorAll(".calligraphy-copy")].map(svg => getComputedStyle(svg).fill),
    }));
    if (!restored.svg || !restored.native || restored.colors.some((color, index) => color !== (index >= 4 ? "rgb(218, 195, 153)" : "rgb(174, 184, 201)")) || fonts.length)
      failures.push({ kind: "restore", restored, fonts });
    // 入口和宝盒分别沿用自己的交互，不通过修改层级或指针透传掩盖画面重叠。
    await target.setViewportSize({ width: 640, height: 500 }); await target.waitForTimeout(100);
    await target.mouse.move(280, 435);
    if (await target.evaluate(() => document.elementFromPoint(280, 435)?.id) !== "box-button") failures.push({ kind: "reported-hit-point" });
    await target.locator(".journey-link[data-entrance=blog]").focus(); await target.keyboard.press("Enter");
    await target.waitForSelector('#app[data-state="transition"]');
  } finally { await context.close(); }

  // 阻塞真实场景模块以保留等待页，验证内联样式在主场景尚未就绪时也能提供系统对比底板。
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, forcedColors: "active", colorScheme });
    const target = await context.newPage();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const pattern = /\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/;
    await target.route(pattern, async route => { await gate; await route.continue(); });
    try {
      const requested = target.waitForRequest(pattern);
      await target.goto(origin, { waitUntil: "domcontentloaded" }); await requested;
      const loading = await target.evaluate(() => {
        const loader = document.querySelector("#moon-loader"), label = loader.querySelector(".calligraphy-text");
        const style = getComputedStyle(label), rect = label.getBoundingClientRect();
        const probe = document.createElement("span"); probe.style.color = "CanvasText"; probe.style.background = "Canvas";
        document.body.append(probe);
        const system = getComputedStyle(probe), colors = { text: system.color, canvas: system.backgroundColor }; probe.remove();
        return { text: label.textContent, visible: loader.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          position: style.position, color: style.color, background: style.backgroundColor, colors,
          svg: getComputedStyle(loader.querySelector(".loading-calligraphy")).display,
          fits: rect.width > 20 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight };
      });
      if (loading.text !== "月色正好,欢迎来访" || !loading.visible || !loading.fits || loading.position !== "static" ||
          loading.svg !== "none" || loading.color !== loading.colors.text || loading.background !== loading.colors.canvas)
        failures.push({ kind: "forced-loader", colorScheme, loading });
      await target.screenshot({ path: `output/playwright/calligraphy-loader-forced-${colorScheme}.png` });
      release(); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      if (await target.locator("#moon-loader").count()) failures.push({ kind: "forced-loader-dismiss", colorScheme });
      results.push({ mode: "forced-loader", colorScheme, loading });
    } finally { release(); await context.close(); }
  }

  // 静态背景与 WebGL 使用不同的点击区计算，两条降级路径都要覆盖临界横竖屏。
  for (const mode of ["fallback", "no-script"]) {
    const context = await browser.newContext({ javaScriptEnabled: mode !== "no-script" });
    const target = await context.newPage();
    if (mode === "fallback") await target.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/i.test(type) ? null : original.call(this, type, ...args); };
    });
    try {
      await target.goto(origin);
      if (mode === "fallback") await target.waitForSelector('#app.fallback[data-state="idle"]:not([inert])');
      for (const viewport of [{ width: 640, height: 500 }, { width: 640, height: 550 }, { width: 640, height: 600 }, { width: 320, height: 500 }, { width: 390, height: 844 }]) {
        await target.setViewportSize(viewport); await target.waitForTimeout(100);
        const layout = await inspectLayout(target, mode === "no-script" ? "#static-box" : "#box-button");
        if (layout.overlap || layout.blocked.length || layout.clipped) failures.push({ kind: mode, viewport, layout });
        if (viewport.width === 640 && viewport.height === 500)
          await target.screenshot({ path: `output/playwright/calligraphy-${mode}-640-500.png` });
      }
      results.push({ mode, layouts: 5 });
    } finally { await context.close(); }
  }
  if (failures.length) throw new Error(JSON.stringify(failures));
  return results;
}
