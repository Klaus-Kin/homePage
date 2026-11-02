// 生产预览下普通刷新与忽略缓存刷新各五轮，覆盖 DPR 1/1.5；trace 保留连续画面供截图复核。
async (page) => {
  // 验收显式开启复色诊断，普通访问仍不写入逐帧属性。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin=new URL(page.url()).origin, results=[];
  const assert=(condition,message)=>{if(!condition) throw new Error(message);};
  for(const ratio of [1,1.5]) for(const ignoreCache of [false,true]) {
    const context=await page.context().browser().newContext({viewport:{width:1366,height:768},deviceScaleFactor:ratio});
    await context.addInitScript(() => { window.__moonDiagnostics = true; });
    try {
      await context.addInitScript(()=>{
        window.__refreshFrames=[];
        document.addEventListener('DOMContentLoaded',()=>{
          const tick=()=>{
            const app=document.querySelector('#app');
            window.__refreshFrames.push({time:performance.now(),loader:!!document.querySelector('#moon-loader'),
              interactive:app.dataset.state==='idle'&&!app.inert,
              icons:[...document.querySelectorAll('.entry-icon')].map(slot=>({
                kind:slot.closest('[data-entrance]').dataset.entrance,ready:slot.dataset.modelReady==='true',
                progress:Number(slot.dataset.colorReveal??0),
                active:slot.closest('[data-entrance]').matches(':hover, :focus-visible'),
                css:Number(getComputedStyle(slot.querySelector('.entry-color')).getPropertyValue('--entry-color-progress')),
                visible:getComputedStyle(slot.querySelector('.entry-fallback')).visibility,
              }))});
            if(window.__refreshFrames.length<1200) requestAnimationFrame(tick);
          };requestAnimationFrame(tick);
        },{once:true});
      });
      const target=await context.newPage(), errors=[];
      target.on('pageerror',error=>errors.push(error.message));
      const cdp=await context.newCDPSession(target);
      await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:ignoreCache});
      await target.goto(origin);await target.bringToFront();
      await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
      assert(await target.evaluate(()=>devicePixelRatio)===ratio,'DPR 准备失败');
      await context.tracing.start({screenshots:true,snapshots:false});
      for(let iteration=1;iteration<=5;iteration++) {
        const kind=iteration%2?'blog':'world';
        await target.locator(`[data-entrance=${kind}] .entry-copy`).hover();
        await target.waitForTimeout(750);
        if(ignoreCache) {
          const navigated=target.waitForEvent('domcontentloaded');
          await cdp.send('Page.reload',{ignoreCache:true});await navigated;
        } else await target.reload({waitUntil:'domcontentloaded'});
        await target.waitForSelector('#app[data-state="idle"]:not([inert])');
        await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
        // Chromium 导航后可能等待新的指针事件才更新 :hover；入口就绪后再次悬停，核对刷新后的完整复色。
        await target.locator(`[data-entrance=${kind}] .entry-copy`).hover();
        await target.waitForTimeout(850);
        const frames=await target.evaluate(()=>window.__refreshFrames);
        for(const entry of ['blog','world']) {
          const states=frames.filter(frame=>frame.interactive).map(frame=>frame.icons.find(icon=>icon.kind===entry));
          const active=states.filter(state=>state.active&&state.ready);
          assert(active.every((state,index)=>!index||state.progress>=active[index-1].progress),
            `DPR ${ratio}/${ignoreCache}/${iteration}/${entry}: 复色回跳`);
          assert(states.filter(state=>!state.ready).every(state=>state.visible==='visible'),'首帧前隐藏后备图');
          assert(states.filter(state=>!state.active&&state.ready).every(state=>state.progress===0),'默认月夜色改变');
          const index=states.findIndex(state=>state.ready);
          if(index>0&&states[index].active&&states[index-1].active)
            assert(states[index].progress+.03>=states[index-1].css,'交接首帧低于前一后备帧');
        }
        assert(frames.some(frame=>frame.loader)&&frames.some(frame=>frame.interactive),'缺少加载或交接画面');
        const selected=frames.at(-1).icons.find(icon=>icon.kind===kind);
        assert(selected.active&&selected.progress===1,`刷新后的真实指针没有命中 ${kind}: ${JSON.stringify(selected)}`);
        await target.screenshot({path:`output/playwright/refresh-${ratio}-${ignoreCache?'no-cache':'normal'}-${iteration}.png`});
        results.push({ratio,ignoreCache,iteration,kind,frames:frames.length,selected});
      }
      await context.tracing.stop({path:`output/playwright/refresh-${ratio}-${ignoreCache?'no-cache':'normal'}.zip`});
      assert(!errors.length,JSON.stringify(errors));
    } finally {await context.close();}
  }
  return results;
}
