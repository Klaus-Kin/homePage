// 在真实浏览器中向绘制、尺寸重算和提交注入故障；最后成功帧必须逐像素保留。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  for (const kind of ["fill", "resize", "commit"]) {
    const context = await browser.newContext({viewport:{width:1366,height:768}}), target = await context.newPage();
    const errors = [], logs = []; let navigations = 0;
    target.on("pageerror",error=>errors.push(error.message));
    target.on("console",message=>{ if (message.type()==="error") logs.push(message.text()); });
    try {
      await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      // 随页面配置读取真实入口，但由本地响应接管，确保故障检查不会离开验收环境。
      const destination = await target.locator("[data-entrance=blog]").getAttribute("href");
      await target.route(destination,async route=>{ navigations++; await route.fulfill({contentType:"text/html",body:"<h1>Ink destination</h1>"}); });
      await target.clock.install(); await target.clock.pauseAt(new Date(Date.now()+100));
      await target.locator("[data-entrance=blog]").focus(); await target.keyboard.press("Enter");
      const stage = () => target.locator("#ink-transition").getAttribute("data-stage");
      for (let i=0;i<650 && await stage()!=="spread";i++) await target.clock.runFor(16);
      if (await stage()!=="spread") throw new Error("未进入扩散阶段");
      await target.clock.runFor(800);
      const before = await target.screenshot({path:`output/playwright/ink-failure-${kind}-before.png`});
      const initial = await target.evaluate(fault=>{
        const canvas=document.querySelector("#ink-transition canvas"), ctx=canvas.getContext("2d");
        window.__lastInkPixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let black=0; for(let i=0;i<window.__lastInkPixels.length;i+=4) if(window.__lastInkPixels[i+3]===255) black++;
        // 对所有墨水画布注入，避免双缓冲切换后仅命中前台画布而漏掉实际绘制故障。
        const method=fault==="resize"?"setTransform":"fill", original=CanvasRenderingContext2D.prototype[method];
        if(fault==="commit") canvas.replaceWith=()=>{throw new Error("injected ink commit failure");};
        else CanvasRenderingContext2D.prototype[method]=function(...args){
          if(this.canvas.closest("#ink-transition") || this.canvas.dataset.inkSurface==="true") throw new Error(`injected ink ${fault} failure`);
          return original.apply(this,args);
        };
        if(fault==="resize") dispatchEvent(new Event("resize"));
        return {black};
      },kind);
      await target.clock.runFor(16);
      const retained=await target.evaluate(()=>{
        const canvas=document.querySelector("#ink-transition canvas"), pixels=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
        let mismatch=Math.abs(pixels.length-window.__lastInkPixels.length);
        for(let i=0;i<pixels.length;i++) if(pixels[i]!==window.__lastInkPixels[i]) mismatch++;
        return {mismatch,stage:document.querySelector("#ink-transition").dataset.stage};
      });
      const after=await target.screenshot({path:`output/playwright/ink-failure-${kind}-after.png`});
      if(initial.black<1000 || retained.mismatch || retained.stage!=="fade" || !before.equals(after))
        throw new Error(`${kind}: 故障时墨迹丢失或画面闪回 ${JSON.stringify({initial,retained,sameScreenshot:before.equals(after)})}`);
      await target.clock.runFor(192);
      if(await stage()!=="black" || navigations) throw new Error("故障后未先淡黑再停留");
      await target.clock.runFor(176); await target.waitForURL(destination);
      if(navigations!==1 || errors.length || !logs.some(log=>log.includes("[ink-transition]"))) throw new Error(JSON.stringify({errors,logs,navigations}));
      results.push({kind,inkPixels:initial.black,mismatch:retained.mismatch,sameScreenshot:true,navigations});
    } finally {await context.close();}
  }
  return results;
}
