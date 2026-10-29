// 使用真实生产页面和浏览器时钟验证落墨，所有像素检查均来自未修改页面的截图。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  async function setup(viewport = { width: 1366, height: 768 }, options = {}) {
    const { fault, reduced = false, dpr = 1 } = options;
    const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
    const target = await context.newPage(), errors = [], logs = [];
    let navigations = 0;
    target.on("pageerror", error => errors.push(error.message));
    target.on("console", message => { if (message.type() === "error") logs.push(message.text()); });
    if (fault) await target.addInitScript(kind => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (kind.startsWith("fallback") && /webgl/i.test(type)) return null;
        if (this.dataset.inkSurface === "true" && kind === "canvas-unavailable") return null;
        return original.call(this, type, ...args);
      };
    }, fault);
    await target.route("https://example.com/blog", async route => { navigations++; await route.fulfill({ contentType: "text/html", body: "<h1>Ink destination</h1>" }); });
    await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
    await target.clock.install(); await target.clock.pauseAt(new Date(Date.now() + 100));
    // 记录 DOM 真正提交的黑场与导航，晚帧和后台用同一个前台时间轴验证。
    await target.evaluate(() => {
      window.__inkEvents = [];
      const observer = new MutationObserver(() => {
        const layer = document.querySelector("#ink-transition");
        if (layer.dataset.black === "true" && !window.__inkEvents.some(e => e.kind === "black")) window.__inkEvents.push({ kind: "black", now: performance.now() });
      });
      observer.observe(document.querySelector("#ink-transition"), { attributes: true });
    });
    const trigger = fault === "fallback-text" ? "[data-entrance=blog]" : "[data-entrance=blog]";
    await target.locator(trigger).focus(); await target.keyboard.press("Enter"); await target.keyboard.press("Enter");
    return { target, context, errors, logs, navigations: () => navigations };
  }
  const inspect = target => target.evaluate(() => {
    const layer = document.querySelector("#ink-transition"), glyph = document.querySelector('#inscription [data-character="界"]').getBoundingClientRect();
    const canvas = layer.querySelector("canvas");
    return { stage: layer.dataset.stage, elapsed: +layer.dataset.elapsed, black: layer.dataset.black, origin: layer.dataset.origin?.split(",").map(Number),
      fade: +layer.querySelector(".ink-shade").style.opacity, complete: document.querySelector("#inscription").dataset.complete,
      white: document.querySelector("#whiteout").dataset.white, glyph: glyph.toJSON(), width: innerWidth, height: innerHeight,
      buffer: [canvas.width, canvas.height], cursor: getComputedStyle(document.documentElement).cursor,
      staff: getComputedStyle(document.querySelector(".staff-cursor-layer")).visibility, events: window.__inkEvents };
  });
  async function until(target, predicate, max = 650) {
    for (let i = 0; i < max; i++) { const value = await inspect(target); if (predicate(value)) return value; await target.clock.runFor(16); }
    throw new Error("未达到预期落墨阶段");
  }
  async function screenshot(target, name, black = false) {
    const shot = await target.screenshot({ path: `output/playwright/ink-${name}.png` });
    if (!black) return;
    const pixels = await target.evaluate(async uri => {
      const image = new Image(); image.src = uri; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height).data;
      let mismatch = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] || data[i+1] || data[i+2] || data[i+3] !== 255) mismatch++;
      return { mismatch, pixels: data.length / 4 };
    }, `data:image/png;base64,${shot.toString("base64")}`);
    if (pixels.mismatch) throw new Error(`${name}: 全黑画面含 ${pixels.mismatch} 个非不透明黑色像素`);
    return pixels;
  }
  // 包括历史三个 P2 视口；不移动指针来规避检查，墨层必须自然隐藏所有光标。
  for (const [name, width, height] of [["desktop",1366,768],["phone",390,844],["ultrawide",3440,1440],["small",320,480],["landscape",640,600],["square",1100,1000]]) {
    const check = await setup({ width, height }, { dpr: name === "phone" ? 3 : 1 }), { target, context } = check;
    try {
      await target.mouse.move(width - 30, height - 30);
      const start = await until(target, s => s.stage === "drop");
      const expected = [Math.max(24, Math.min(width-24, start.glyph.left + start.glyph.width*.85)), Math.max(24, Math.min(height-24, start.glyph.top + start.glyph.height*.72))];
      if (start.complete !== "true" || start.elapsed !== 0 || start.origin.some((n,i) => Math.abs(n-expected[i]) > .01)) throw new Error(`${name}: 落点或立即启动不符 ${JSON.stringify(start)}`);
      if (start.buffer[0]*start.buffer[1] > 2500000 || start.buffer[0]/width > 1.5 || start.cursor !== "none" || start.staff !== "hidden") throw new Error("绘制预算或光标隐藏异常");
      await target.clock.runFor(48); await screenshot(target, `${name}-drop`);
      await target.clock.runFor(192); await screenshot(target, `${name}-splash`);
      await target.clock.runFor(160); await screenshot(target, `${name}-settled`);
      await target.clock.runFor(624); await screenshot(target, `${name}-spread`);
      const ink = await inspect(target);
      // 横竖屏重算落点与范围，不重放时间轴；恢复原尺寸后继续渗染。
      await target.setViewportSize({width:height,height:width});
      if ((await inspect(target)).elapsed !== ink.elapsed) throw new Error("旋转重播落墨");
      await target.setViewportSize({width,height});
      const black = await until(target, s => s.black === "true");
      const pixels = await screenshot(target, `${name}-black`, true);
      // 黑场期间改变尺寸仍须全黑，Canvas 重设不得闪出淡黄纸面。
      await target.setViewportSize({width:height,height:width}); await screenshot(target, `${name}-black-rotated`, true);
      await target.setViewportSize({width,height});
      await target.clock.runFor(144); await screenshot(target, `${name}-before-navigation`, true);
      if (check.navigations()) throw new Error("纯黑尚未停留满160ms");
      await target.clock.runFor(32); await target.waitForURL("https://example.com/blog");
      if (check.navigations() !== 1 || check.errors.length || check.logs.length) throw new Error(JSON.stringify(check));
      results.push({ name, origin: start.origin, buffer: start.buffer, blackAt: black.events, pixels, navigationOnce: true });
    } finally { await context.close(); }
  }
  for (const kind of ["reduced", "reduced-switch-back", "switch-drop", "switch-spread", "hidden-drop", "hidden-splash", "hidden-spread", "hidden-fade", "hidden-black", "canvas-unavailable", "canvas-draw-failure", "fallback-button", "fallback-text", "late-black"]) {
    const reduced = ["reduced", "reduced-switch-back", "hidden-fade", "hidden-black"].includes(kind);
    const fault = kind.startsWith("canvas") || kind.startsWith("fallback") ? kind : undefined;
    const check = await setup(undefined, { reduced, fault }), { target, context } = check;
    try {
      await until(target, s => s.stage && s.stage !== "waiting");
      if (kind === "reduced-switch-back") {
        await target.emulateMedia({reducedMotion:"no-preference"}); await target.clock.runFor(16);
        const locked = await inspect(target);
        if (locked.white !== "true" || locked.complete !== "true" || locked.stage !== "fade") throw new Error("减少动态完成后切回普通模式使题词或底幕倒退");
      }
      if (kind.includes("spread") || kind === "canvas-draw-failure") await target.clock.runFor(800);
      if (kind === "hidden-splash") await target.clock.runFor(192);
      if (kind.startsWith("switch")) {
        const before = await inspect(target);
        await target.emulateMedia({reducedMotion:"reduce"}); await target.clock.runFor(16);
        const frozen = await inspect(target);
        if (frozen.elapsed !== before.elapsed || frozen.stage !== "fade") throw new Error("偏好切换没有冻结已画墨迹");
        await target.emulateMedia({reducedMotion:"no-preference"});
        await target.clock.runFor(160);
        if ((await inspect(target)).black === "true") throw new Error("淡黑不足180ms");
      }
      if (kind === "canvas-draw-failure") {
        await target.evaluate(() => {
          const fill = CanvasRenderingContext2D.prototype.fill;
          // 两张墨水画布轮换，故障注入必须覆盖实际使用的备用画布。
          CanvasRenderingContext2D.prototype.fill = function(...args) {
            if (this.canvas.dataset.inkSurface === "true") throw new Error("injected ink drawing failure");
            return fill.apply(this,args);
          };
        });
        await target.clock.runFor(16);
        if ((await inspect(target)).stage !== "fade") throw new Error("绘制失败未立即淡黑");
      }
      if (kind.startsWith("hidden")) {
        if (kind === "hidden-black") await until(target, s => s.black === "true");
        const before = await inspect(target);
        await target.evaluate(() => { Object.defineProperty(document,"hidden",{configurable:true,get:()=>true}); document.dispatchEvent(new Event("visibilitychange")); });
        await target.clock.runFor(20000);
        if (JSON.stringify(await inspect(target)) !== JSON.stringify(before) || check.navigations()) throw new Error(`${kind}: 后台推进了时间轴`);
        await target.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
        await target.clock.runFor(16);
        if (check.navigations()) throw new Error("恢复首帧提前导航");
      }
      if (kind === "late-black") {
        await target.clock.fastForward(10000);
        if ((await inspect(target)).black !== "true" || check.navigations()) throw new Error("晚帧提前消耗全黑停留");
      }
      const black = await until(target, s => s.black === "true");
      await screenshot(target, kind, true);
      if (check.navigations()) throw new Error("未检查黑场便导航");
      await target.clock.runFor(176); await target.waitForURL("https://example.com/blog");
      if (check.navigations() !== 1 || check.errors.length) throw new Error(`${kind}: ${JSON.stringify(check.errors)}`);
      if (kind.startsWith("canvas") && !check.logs.some(s => s.includes("[ink-transition]"))) throw new Error("Canvas 故障缺少上下文日志");
      results.push({ kind, blackAt: black.events, navigationOnce: true, logs: check.logs });
    } finally { await context.close(); }
  }
  return results;
}
