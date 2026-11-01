// 在新鲜生产预览中使用 playwright-cli run-code --filename 执行；延迟真实图标模块并采集 GPU uniform 和连续交接帧。
async (page) => {
  const browser=page.context().browser(), origin=new URL(page.url()).origin, results=[];
  const assert=(condition,message)=>{if(!condition) throw new Error(message);};
  for(const kind of ['blog','world']) for(const input of ['hover','focus']) for(const progress of [0,.5,1]) {
    const context=await browser.newContext({viewport:{width:1366,height:768}});
    let release;
    try {
      // 记录实际传给 GPU 的复色值，避免只检查 DOM 上的诊断属性而遗漏首帧绘制。
      await context.addInitScript(() => {
        for(const type of [WebGLRenderingContext,WebGL2RenderingContext]) {
          const locations=new WeakMap(), get=type.prototype.getUniformLocation, set=type.prototype.uniform1f;
          type.prototype.getUniformLocation=function(program,name) {
            const location=get.call(this,program,name);if(location) locations.set(location,name);return location;
          };
          type.prototype.uniform1f=function(location,value) {
            if(locations.get(location)==='artworkReveal') this.canvas.dataset.gpuColorReveal=String(value);
            return set.call(this,location,value);
          };
        }
        window.__entryHandoff=[];
        document.addEventListener('DOMContentLoaded',()=>{
          const sample=(event)=>{
            for(const slot of document.querySelectorAll('.entry-icon')) {
              const fallback=slot.querySelector('.entry-color'), canvas=slot.querySelector('canvas');
              window.__entryHandoff.push({event,kind:slot.closest('[data-entrance]').dataset.entrance,
                interactive:document.querySelector('#app').dataset.state==='idle'&&!document.querySelector('#app').inert,
                ready:slot.dataset.modelReady==='true',progress:Number(slot.dataset.colorReveal??0),
                gpu:Number(canvas?.dataset.gpuColorReveal??0),
                css:Number(getComputedStyle(fallback).getPropertyValue('--entry-color-progress')),
                visible:getComputedStyle(fallback.closest('.entry-fallback')).visibility,
                cursor:Number(document.querySelector('.staff-cursor-layer img[data-color-reveal]')?.dataset.colorReveal??0)});
            }
          };
          new MutationObserver(()=>sample('mutation')).observe(document.querySelector('.journey-links')??document.querySelector('#app'),
            {subtree:true,attributes:true,attributeFilter:['data-model-ready']});
          const tick=()=>{sample('frame');if(window.__entryHandoff.length<2400) requestAnimationFrame(tick);};
          requestAnimationFrame(tick);
        },{once:true});
      });
      const target=await context.newPage(), errors=[];
      target.on('pageerror',error=>errors.push(error.message));
      const gate=new Promise(resolve=>{release=resolve;});
      await target.route(/\/assets\/entry-icons-[^/]+\.js$/,async route=>{await gate;await route.continue();});
      await target.goto(origin,{waitUntil:'domcontentloaded'});await target.bringToFront();
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      const link=target.locator(`[data-entrance=${kind}]`), slot=link.locator('.entry-icon');
      if(input==='hover') await link.locator('.entry-copy').hover();
      else {await target.mouse.move(1300,5);await target.keyboard.press('Tab');await link.focus();}
      // 用浏览器自己的 CSS 动画固定真实后备边界；模块和 GPU 仍按实际异步路径完成接管。
      await link.locator('.entry-color').evaluate((el,progress)=>{
        const animation=el.getAnimations()[0];animation.pause();animation.currentTime=progress*700;
      },progress);
      const before=await link.locator('.entry-color').evaluate(el=>Number(getComputedStyle(el).getPropertyValue('--entry-color-progress')));
      assert(Math.abs(before-progress)<.001,`${kind}/${input}: 后备采样准备失败`);
      const clip=await slot.evaluate(el=>{
        const r=el.getBoundingClientRect();return {x:r.x-30,y:r.y-30,width:r.width+60,height:r.height+60};
      });
      const prefix=`output/playwright/entry-handoff-${kind}-${input}-${progress}`;
      await target.screenshot({path:`${prefix}-before.png`,clip});
      release();
      await target.waitForFunction(kind=>document.querySelector(`[data-entrance=${kind}] .entry-icon`).dataset.modelReady==='true',kind);
      await target.screenshot({path:`${prefix}-after.png`,clip});
      await target.waitForTimeout(120);
      const samples=await target.evaluate(kind=>window.__entryHandoff.filter(row=>row.kind===kind),kind);
      const first=samples.find(row=>row.ready), active=samples.filter(row=>row.ready);
      assert(first&&first.progress>=progress&&first.gpu>=progress,`${kind}/${input}/${progress}: 交接回灰 ${JSON.stringify(first)}`);
      assert(active.every((row,index)=>row.gpu+.00001>=progress&&(!index||row.progress>=active[index-1].progress)),
        `${kind}/${input}/${progress}: 连续帧回退`);
      assert(samples.filter(row=>row.interactive&&!row.ready).every(row=>row.visible==='visible'),`${kind}: 提前隐藏静态图`);
      if(input==='hover') {
        // 下一次共享 RAF 更新后，手指与图标必须读到同一条接管后的时间线。
        const last=active.at(-1);assert(Math.abs(last.cursor-last.progress)<.08,`${kind}: 鼠标时钟没有同步`);
        await target.mouse.move(1300,5);
      } else await link.evaluate(el=>el.blur());
      await target.waitForFunction(kind=>Number(document.querySelector(`[data-entrance=${kind}] .entry-icon`).dataset.colorReveal)===0,kind);
      if(input==='hover') await link.locator('.entry-copy').hover();else await link.focus();
      await target.waitForTimeout(50);
      const restarted=await slot.evaluate(el=>Number(el.dataset.colorReveal));
      assert(restarted<.45,`${kind}/${input}: 移出重进没有归零 ${restarted}`);
      assert(!errors.length,JSON.stringify(errors));
      results.push({kind,input,progress,first,frames:active.length,restarted});
    } finally {release?.();await context.close();}
  }
  // 预热的零进度可以成功，但同步后的实际首帧提交失败时，整张后备图仍必须可见。
  for(const kind of ['blog','world']) {
    const context=await browser.newContext({viewport:{width:1366,height:768}});
    let release;
    try {
      await context.addInitScript(()=>{
        for(const type of [WebGLRenderingContext,WebGL2RenderingContext]) {
          const locations=new WeakMap(), get=type.prototype.getUniformLocation, set=type.prototype.uniform1f;
          type.prototype.getUniformLocation=function(program,name) {
            const location=get.call(this,program,name);if(location) locations.set(location,name);return location;
          };
          type.prototype.uniform1f=function(location,value) {
            if(locations.get(location)==='artworkReveal'&&value>.5) throw new Error('controlled first color frame failure');
            return set.call(this,location,value);
          };
        }
      });
      const target=await context.newPage(), gate=new Promise(resolve=>{release=resolve;});
      await target.route(/\/assets\/entry-icons-[^/]+\.js$/,async route=>{await gate;await route.continue();});
      await target.goto(origin,{waitUntil:'domcontentloaded'});await target.bringToFront();
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.keyboard.press('Tab');await target.locator(`[data-entrance=${kind}]`).focus();
      await target.waitForFunction(kind=>Number(getComputedStyle(document.querySelector(`[data-entrance=${kind}] .entry-color`))
        .getPropertyValue('--entry-color-progress'))===1,kind);
      const failed=target.waitForEvent('console',{predicate:message=>message.text().includes('入口立体图标不可用')});
      release();await failed;
      const state=await target.locator(`[data-entrance=${kind}] .entry-icon`).evaluate(slot=>({
        ready:slot.dataset.modelReady,canvas:!!slot.querySelector('canvas'),
        visible:getComputedStyle(slot.querySelector('.entry-fallback')).visibility,
        progress:Number(getComputedStyle(slot.querySelector('.entry-color')).getPropertyValue('--entry-color-progress')),
      }));
      assert(!state.ready&&!state.canvas&&state.visible==='visible'&&state.progress===1,`${kind}: 首帧失败后丢失原图`);
      await target.screenshot({path:`output/playwright/entry-handoff-${kind}-failed.png`});
      results.push({kind,failure:'first-color-frame',...state});
    } finally {release?.();await context.close();}
  }
  return results;
}
