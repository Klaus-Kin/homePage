// 通过 playwright-cli run-code --filename 执行；生产预览验证首屏独立于 CSS 请求、鼠标事件与交接连续性。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const [name, width, height, reduced] of [["desktop",1366,768,false], ["desktop-slow",1366,768,false], ["phone",390,844,false], ["short",844,390,false], ["reduced",1366,768,true]]) {
    const context = await page.context().browser().newContext({ viewport: { width, height },
      isMobile: name === "phone", hasTouch: name === "phone", reducedMotion: reduced ? "reduce" : "no-preference" });
    const target = await context.newPage(), errors = [], css = [];
    target.on("pageerror", error => errors.push(error.message));
    try {
      if (name === "desktop-slow") await (await context.newCDPSession(target)).send("Emulation.setCPUThrottlingRate",{rate:4});
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      // 故意断开外链 CSS；独立加载反馈、主页和无脚本静态页面都应使用内联生产样式。
      await target.route(/\.css(?:\?|$)/, route => { css.push(route.request().url()); return route.abort(); });
      await target.route(/\/assets\/index-[^/]+\.js$/, async route => {
        await new Promise(resolve => setTimeout(resolve, 1200)); await route.continue();
      });
      await target.addInitScript(() => {
        window.__cursorReview = { moves: [], frames: [], tasks: [] };
        new PerformanceObserver(list => window.__cursorReview.tasks.push(...list.getEntries().map(e => ({ start:e.startTime, duration:e.duration })))).observe({ type:"longtask", buffered:true });
        requestAnimationFrame(function sample() {
          const layer = document.querySelector(".staff-cursor-layer"), root = document.documentElement;
          if (layer) window.__cursorReview.frames.push({ hidden:layer.hidden, native:getComputedStyle(root).cursor !== "none", active:root.classList.contains("staff-cursor-active") });
          requestAnimationFrame(sample);
        });
        // 在主模块之后注册观察器，检查同一次真实 pointermove 返回前是否已使用最新坐标。
        window.addEventListener("load", () => window.addEventListener("pointermove", event => {
          const layer = document.querySelector(".staff-cursor-layer");
          if (!layer || layer.hidden) return;
          const offsets = {staff:[6,6],point:[10,6],grab:[25,22]}, offset=offsets[layer.dataset.cursorKind];
          const transform = new DOMMatrixReadOnly(layer.firstElementChild.style.transform);
          window.__cursorReview.moves.push({ dx:transform.m41-(event.clientX-offset[0]), dy:transform.m42-(event.clientY-offset[1]), delay:performance.now()-event.timeStamp });
        }));
      });
      await target.goto(origin, {waitUntil:"commit"});
      await target.waitForFunction(() => document.querySelector(".hoop-rotor")?.checkVisibility({ checkVisibilityCSS:true }));
      const first = await target.evaluate(() => ({ color:getComputedStyle(document.documentElement).backgroundColor,
        dark:getComputedStyle(document.documentElement).colorScheme, animations:document.querySelector(".hoop-rotor").getAnimations().length }));
      if (first.color !== "rgb(8, 15, 32)" || first.dark !== "dark" || (!reduced && !first.animations)) throw new Error(`首屏反馈失败：${JSON.stringify(first)}`);
      await target.screenshot({path:`output/playwright/return-audit/${name}-loader.png`});
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      if (name.startsWith("desktop") || reduced) {
        for (let i=0;i<35;i++) { await target.mouse.move(700+i%15*7,350+i%10*3); await target.waitForTimeout(12); }
        await target.waitForFunction(() => document.documentElement.classList.contains("staff-cursor-active"));
        const review=await target.evaluate(()=>window.__cursorReview);
        if (review.moves.length < 20 || review.moves.some(move=>move.dx!==0 || move.dy!==0) || review.frames.some(frame=>frame.active && frame.hidden))
          throw new Error(`鼠标落后输入或隐藏图层提前接管：${JSON.stringify(review)}`);
        // 同一任务内取消刚开始的交接，迟到 RAF 不能在窗口失焦后再次隐藏系统光标。
        await target.evaluate(() => {
          window.dispatchEvent(new Event("blur"));
          document.body.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerType:"mouse",clientX:710,clientY:360}));
          window.dispatchEvent(new Event("blur"));
        });
        await target.waitForTimeout(80);
        if (await target.evaluate(()=>!document.querySelector(".staff-cursor-layer").hidden || document.documentElement.classList.contains("staff-cursor-active")))
          throw new Error("取消的光标交接被迟到帧重新激活");
        results.push({name,first,inputCount:review.moves.length,maxInputDelay:Math.max(...review.moves.map(move=>move.delay)),longTasks:review.tasks});
      } else results.push({name,first});
      await target.screenshot({path:`output/playwright/return-audit/${name}-idle.png`});
      if (css.length || errors.length) throw new Error(JSON.stringify({name,css,errors}));
    } finally { await context.close(); }
  }
  // 无脚本仍需要完整静态样式；移动共享字形后，最终文字和链接不能丢失。
  const context=await page.context().browser().newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  try {
    const target=await context.newPage(); await target.goto(origin);
    const state=await target.evaluate(()=>({loader:getComputedStyle(document.querySelector("#moon-loader")).display,
      app:getComputedStyle(document.querySelector("#app")).visibility,links:[...document.querySelectorAll("[data-entrance]")].map(link=>link.href)}));
    if (state.loader!=="none" || state.app!=="visible" || state.links.length!==2) throw new Error(JSON.stringify(state));
    await target.screenshot({path:"output/playwright/return-audit/no-js.png"}); results.push({noJavaScript:state});
  } finally {await context.close();}
  return results;
}
