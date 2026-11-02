// 生产包复查实际交互与渲染耗时；手机采用桌面浏览器模拟，帧率不代表真机。
async (page) => {
  const browser=page.context().browser(),origin=new URL(page.url()).origin,results=[];
  const assert=(value,message)=>{if(!value) throw new Error(message);};
  for(const [width,height,size,cpu] of [[1366,768,44,1],[390,844,36,1],[640,500,30,1],[390,844,36,4]]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2});
    // 激活状态属于显式诊断数据，新建上下文不能继承驱动页的开关。
    await context.addInitScript(() => { window.__moonDiagnostics = true; });
    const target=await context.newPage(),errors=[];
    target.on('pageerror',error=>errors.push(error.message));
    try {
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
      await target.keyboard.press('Tab');await target.locator('[data-entrance=world]').focus();
      await target.locator('[data-entrance=blog]').hover();await target.waitForTimeout(1400);
      await target.screenshot({path:`output/playwright/entry-icons-production-${size}px-cpu${cpu}.png`});
      if(cpu>1) {
        const cdp=await context.newCDPSession(target);
        await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
      }
      const timing=await target.evaluate(()=>new Promise(resolve=>{
        const intervals=[];let previous,start;
        function frame(now) {
          start??=now;if(previous) intervals.push(now-previous);previous=now;
          if(now-start<1800) requestAnimationFrame(frame);else {
            intervals.sort((a,b)=>a-b);
            resolve({frames:intervals.length,medianMs:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],maxMs:intervals.at(-1)});
          }
        }
        requestAnimationFrame(frame);
      }));
      // 浏览器事件快速反向：同一任务内读取移出/重入前后的位置，禁止重置相位或跳回原点。
      const reversal=await target.locator('[data-entrance=blog]').evaluate(async link=>{
        const copy=link.querySelector('.entry-copy');
        const before=copy.style.transform;
        link.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));
        const afterLeave=copy.style.transform;
        await new Promise(resolve=>setTimeout(resolve,75));
        const beforeReturn=copy.style.transform;
        link.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
        return {before,afterLeave,beforeReturn,afterReturn:copy.style.transform};
      });
      assert(reversal.before===reversal.afterLeave&&reversal.beforeReturn===reversal.afterReturn,'快速反向重置了当前文字位置');
      await target.locator('[data-entrance=blog]').evaluate(link=>link.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'})));
      // 键盘焦点仍在猴头入口时移出鼠标，必须继续播放；宝盒提示只能作用于外层。
      await target.mouse.move(width-5,5);await target.waitForTimeout(550);
      assert(await target.locator('[data-entrance=world]').getAttribute('data-entry-active')==='true','鼠标移出错误地清除了键盘激活');
      await target.locator('#box-button').evaluate(button=>button.click());
      await target.waitForTimeout(200);
      assert(await target.evaluate(()=>document.querySelector('#journey-choices').dataset.prompt==='true'&&
        document.querySelector('.choice-motion').getAnimations().length===1&&document.querySelector('.journey-copy').style.transform!=='none'),'内层悬停覆盖外层提示');
      const densities=await target.locator('canvas.entry-canvas').evaluateAll(canvases=>canvases.map(canvas=>({buffer:canvas.width,display:canvas.getBoundingClientRect().width})));
      // 提示位移会使 48px 的边界读成 47.999996px；仅容忍这一级浮点误差，仍检查实际缓冲密度。
      assert(densities.every(({buffer,display})=>buffer/display<=2+1e-6),`实际画布 DPR 超过 2：${JSON.stringify({size,cpu,densities})}`);
      assert(errors.length===0,JSON.stringify(errors));
      results.push({viewport:[width,height],size,cpu,timing,rapidReentry:true,prompt:true,errors});
    } finally {await context.close();}
  }
  return results;
}
