// 生产预览验证原始 RGBA 的网络失败、截断回退与下载期间取消，不能只依赖纯函数像素测试。
async (page) => {
  const origin=new URL(page.url()).origin,results=[];
  for(const mode of ['missing','truncated','cancel']) {
    const context=await page.context().browser().newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
    let release;
    try {
      const target=await context.newPage(),errors=[],warnings=[];
      target.on('pageerror',error=>errors.push(error.message));
      target.on('console',message=>{if(message.type()==='warning'&&message.text().includes('预生成纹理')) warnings.push(message.text());});
      if(mode==='cancel') {
        const gate=new Promise(resolve=>{release=resolve;});
        await target.route('**/texture-ground.rgba',async route=>{await gate;await route.abort();});
        await target.addInitScript(()=>{
          window.__textureContexts=[];
          const original=HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext=function(type,...args){
            const context=original.call(this,type,...args);
            if(String(type).includes('webgl')&&context) window.__textureContexts.push(context);
            return context;
          };
        });
      } else await target.route('**/texture-*.rgba',route=>mode==='missing'?route.abort():route.fulfill({body:'truncated',contentType:'application/octet-stream'}));
      const requested=mode==='cancel'?target.waitForRequest('**/texture-ground.rgba'):null;
      await target.goto(origin,{waitUntil:'domcontentloaded'});
      if(mode==='cancel') {
        await requested;
        await target.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
        release();await target.waitForTimeout(150);
        const state=await target.evaluate(()=>({canvas:document.querySelectorAll('#scene canvas').length,
          cursor:!!document.querySelector('.staff-cursor-layer'),lost:window.__textureContexts.every(context=>context.isContextLost())}));
        if(state.canvas||state.cursor||!state.lost||errors.length) throw new Error(JSON.stringify({mode,state,errors}));
        results.push({mode,...state,errors});
      } else {
        await target.waitForSelector('#app[data-state="idle"]:not([inert])');
        const fallback=await target.locator('#app').evaluate(app=>app.classList.contains('fallback'));
        if(fallback||warnings.length!==4||errors.length) throw new Error(JSON.stringify({mode,fallback,warnings,errors}));
        await target.screenshot({path:`output/playwright/texture-${mode}-recovered.png`});
        results.push({mode,fallback,recoveredTextures:warnings.length,errors});
      }
    } finally {release?.();await context.close();}
  }
  return results;
}
