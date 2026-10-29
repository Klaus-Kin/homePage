// 由现有 Playwright CLI 执行；浏览器实例来自 CLI，不在项目中 require 未声明的 Playwright 包。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  for (const [name,width,height] of [["desktop",1366,768],["phone",390,844]]) {
    const context = await browser.newContext({viewport:{width,height}}), target = await context.newPage();
    const frames = [], acknowledgements = [];
    try {
      // 全黑停留很短，页面内观察器回传实际提交帧，避免轮询错过。
      let resolveBlack;
      const presentedBlack = new Promise(resolve => { resolveBlack = resolve; });
      await target.exposeFunction("recordInkBlack",sample=>resolveBlack(sample));
      await target.route("https://example.com/blog",route=>route.fulfill({contentType:"text/html",body:"<h1>Destination</h1>"}));
      await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.evaluate(()=>{
        window.__inkPerformance={gaps:[],draws:[]}; let previous, started;
        const observer=new MutationObserver(()=>{
          if(document.querySelector("#ink-transition").dataset.black==="true"){
            observer.disconnect(); window.recordInkBlack(window.__inkPerformance);
          }
        });
        observer.observe(document.querySelector("#ink-transition"),{attributes:true});
        const clear=CanvasRenderingContext2D.prototype.clearRect, fill=CanvasRenderingContext2D.prototype.fill;
        CanvasRenderingContext2D.prototype.clearRect=function(...args){
          if(this.canvas.dataset.inkSurface==="true") started=performance.now();
          return clear.apply(this,args);
        };
        CanvasRenderingContext2D.prototype.fill=function(...args){
          const result=fill.apply(this,args);
          if(this.canvas.dataset.inkSurface==="true") window.__inkPerformance.draws.push(performance.now()-started);
          return result;
        };
        // 备用画布也纳入绘制成本，RAF 数据只代表当前浏览器，不代表手机真机。
        const sample=now=>{
          const ink=document.querySelector("#ink-transition");
          if(ink && !ink.hidden && !ink.dataset.black){
            if(previous) window.__inkPerformance.gaps.push(now-previous); previous=now;
          }
          requestAnimationFrame(sample);
        }; requestAnimationFrame(sample);
      });
      const cdp=await context.newCDPSession(target);
      cdp.on("Page.screencastFrame",event=>{
        frames.push({data:event.data,time:event.metadata.timestamp});
        acknowledgements.push(cdp.send("Page.screencastFrameAck",{sessionId:event.sessionId}));
      });
      await cdp.send("Page.startScreencast",{format:"jpeg",quality:92,maxWidth:width,maxHeight:height,everyNthFrame:2});
      await target.locator("#box-button").focus(); await target.keyboard.press("Enter");
      const performance=await Promise.race([presentedBlack,target.waitForTimeout(20000).then(()=>{throw new Error(`${name}: 未收到全黑提交帧`);})]);
      await target.waitForURL("https://example.com/blog"); await target.waitForTimeout(100);
      await cdp.send("Page.stopScreencast"); await Promise.all(acknowledgements);
      if(frames.length<30) throw new Error(`${name}: insufficient recording frames`);
      const gaps=performance.gaps.sort((a,b)=>a-b);
      results.push({name,frames,animationFrames:gaps.length,p50Ms:gaps[Math.floor(gaps.length*.5)],p95Ms:gaps[Math.floor(gaps.length*.95)],maxDrawSubmitMs:Math.max(...performance.draws)});
    } finally {await context.close();}
  }
  // CLI 的 --raw 输出供本地 Node 入口解析；图像数据不打印到用户终端。
  return results;
}
