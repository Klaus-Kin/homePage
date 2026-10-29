// 在亮色与暗色高对比度调色板中检查真实截图，覆盖墨水扩散和减少动态淡黑两条路径。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  for (const colorScheme of ["light", "dark"]) for (const reduced of [false, true]) {
    const name = `forced-${colorScheme}-${reduced ? "reduced" : "normal"}`;
    const context = await browser.newContext({ viewport: { width: 640, height: 600 }, forcedColors: "active", colorScheme,
      reducedMotion: reduced ? "reduce" : "no-preference" });
    const target = await context.newPage(), errors = [];
    let navigations = 0;
    target.on("pageerror", error => errors.push(error.message));
    await target.route("https://example.com/blog", async route => {
      navigations++;
      await route.fulfill({ contentType: "text/html", body: "<h1>Forced colors destination</h1>" });
    });
    try {
      await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.clock.install(); await target.clock.pauseAt(new Date(Date.now() + 100));
      const palette = await target.evaluate(() => {
        // 系统 Canvas 色用于确认浏览器确实启用了目标调色板，不能仅依赖媒体查询的布尔值。
        const probe = document.createElement("div"); probe.style.backgroundColor = "Canvas";
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor; probe.remove();
        return { active: matchMedia("(forced-colors: active)").matches, color };
      });
      if (!palette.active || palette.color !== (colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)"))
        throw new Error(`${name}: 强制颜色调色板未正确启用 ${JSON.stringify(palette)}`);
      await target.locator("[data-entrance=blog]").focus(); await target.keyboard.press("Enter");
      const inspect = () => target.evaluate(() => {
        const layer = document.querySelector("#ink-transition"), shade = layer.querySelector(".ink-shade");
        return { stage: layer.dataset.stage, elapsed: +layer.dataset.elapsed, fade: +shade.style.opacity,
          black: layer.dataset.black, layerColor: getComputedStyle(layer).backgroundColor,
          shadeColor: getComputedStyle(shade).backgroundColor };
      });
      async function until(predicate) {
        for (let i = 0; i < 650; i++) { const state = await inspect(); if (predicate(state)) return state; await target.clock.runFor(16); }
        throw new Error(`${name}: 未达到目标阶段`);
      }
      await until(state => state.stage === (reduced ? "fade" : "drop"));
      if (reduced) {
        await target.clock.runFor(80);
        const fading = await inspect();
        // 在最终实心黑底生效之前检查淡黑层，避免只修结束态却遗漏减少动态过程。
        if (fading.fade <= 0 || fading.fade >= 1 || fading.shadeColor !== "rgb(0, 0, 0)")
          throw new Error(`${name}: 淡黑层被强制颜色替换 ${JSON.stringify(fading)}`);
        await target.screenshot({ path: `output/playwright/ink-${name}-fade.png` });
      }
      const black = await until(state => state.black === "true");
      const shot = await target.screenshot({ path: `output/playwright/ink-${name}-black.png` });
      const pixels = await target.evaluate(async uri => {
        const image = new Image(); image.src = uri; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let mismatch = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] || data[i + 1] || data[i + 2] || data[i + 3] !== 255) mismatch++;
        return { mismatch, total: data.length / 4 };
      }, `data:image/png;base64,${shot.toString("base64")}`);
      if (pixels.mismatch || black.layerColor !== "rgb(0, 0, 0)") throw new Error(`${name}: 全黑画面被替换 ${JSON.stringify({ black, pixels })}`);
      await target.clock.runFor(144);
      if (navigations) throw new Error(`${name}: 全黑停留不足160ms便导航`);
      await target.clock.runFor(32); await target.waitForURL("https://example.com/blog");
      if (navigations !== 1 || errors.length) throw new Error(`${name}: ${JSON.stringify({ navigations, errors })}`);
      results.push({ name, palette, pixels, navigations });
    } finally { await context.close(); }
  }
  return results;
}
