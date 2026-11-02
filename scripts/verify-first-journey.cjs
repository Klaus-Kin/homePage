// 使用生产构建和受控浏览器时钟验证首次点击；注入长帧后仍须完整呈现开盖、书写、墨滴与全黑。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin, browser = page.context().browser(), results = [];
  for (const [name, width, height] of [["desktop",1920,1080], ["phone",390,844], ["short",844,390], ["small",320,480]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: name !== "desktop",
      hasTouch: name !== "desktop", reducedMotion: "no-preference" });
    const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; }), errors = [];
    target.setDefaultTimeout(30000);
    target.on("pageerror", error => errors.push(error.message));
    try {
      if (name === "phone") {
        const cdp = await context.newCDPSession(target);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      await target.goto(origin, { waitUntil: "domcontentloaded" });
      await target.bringToFront();
      await target.waitForFunction(() => document.querySelector("#app")?.dataset.state === "idle");
      if (await target.locator("#app").evaluate(app => app.classList.contains("fallback"))) throw new Error(`${name} 意外降级`);
      await target.clock.install();
      await target.clock.pauseAt(new Date(Date.now() + 100));
      await target.locator("[data-entrance=blog]").click({ noWaitAfter: true });
      const inspect = () => target.evaluate(() => ({ state: document.querySelector("#app").dataset.state,
        path: JSON.parse(document.querySelector("#scene").dataset.chestPath),
        ink: document.querySelector("#ink-transition").dataset.stage,
        black: document.querySelector("#ink-transition").dataset.black,
        white: document.querySelector("#whiteout").dataset.white,
        inscription: document.querySelector("#inscription").dataset.mode }));
      await target.clock.runFor(400);
      const opening = await inspect();
      if (opening.state !== "transition" || opening.path.tipWorldY <= opening.path.hingeWorldY)
        throw new Error(`${name} 第一次点击没有实际开盖：${JSON.stringify(opening)}`);
      await target.screenshot({ path: `output/playwright/lifecycle-${name}-opening.png` });
      // 单帧跳过六秒，演出只允许向前推进最多 50ms，不能直接进入光幕或黑场。
      await target.clock.fastForward(6000);
      const stalled = await inspect();
      if (stalled.white === "true" || stalled.black === "true") throw new Error(`${name} 长帧跳过关键镜头`);
      let writing, drop;
      for (let i = 0; i < 650; i++) {
        await target.clock.runFor(16);
        const state = await inspect();
        if (!writing && state.inscription === "writing") writing = state;
        if (state.ink === "drop") { drop = state; break; }
      }
      if (!writing || !drop) throw new Error(`${name} 首次转场缺少书写或墨滴`);
      await target.clock.runFor(48);
      await target.screenshot({ path: `output/playwright/lifecycle-${name}-drop.png` });
      await target.clock.runFor(800);
      const spread = await inspect();
      if (spread.ink !== "spread") throw new Error(`${name} 墨迹没有扩散`);
      await target.screenshot({ path: `output/playwright/lifecycle-${name}-spread.png` });
      for (let i = 0; i < 160 && (await inspect()).black !== "true"; i++) await target.clock.runFor(16);
      const black = await inspect();
      if (black.black !== "true") throw new Error(`${name} 没有最终黑场`);
      await target.screenshot({ path: `output/playwright/lifecycle-${name}-black.png` });
      // 同时验证离页清理的 DOM 后置条件：销毁画布后黑壳必须仍然完整覆盖视口。
      await target.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
      const afterHide = await target.evaluate(() => ({ ink: !!document.querySelector('#ink-transition[data-black="true"]'),
        color: getComputedStyle(document.querySelector("#ink-transition")).backgroundColor,
        canvases: document.querySelectorAll("#ink-transition canvas").length }));
      if (!afterHide.ink || afterHide.color !== "rgb(0, 0, 0)" || afterHide.canvases)
        throw new Error(`离页重新露出题词：${JSON.stringify(afterHide)}`);
      await target.screenshot({ path: `output/playwright/lifecycle-${name}-after-pagehide.png` });
      await target.clock.resume();
      if (errors.length) throw new Error(JSON.stringify(errors));
      results.push({ name, opening: true, survivedLongFrame: true, writing: true, drop: true, spread: true, retainedBlack: afterHide });
    } finally { await context.close(); }
  }
  return results;
}
