// 在生产预览用 playwright-cli run-code --filename 执行；截图及逐帧状态保存于 output/playwright/。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  for (const [width, height, mode] of [[1920,1080,'webgl'],[390,844,'webgl'],[844,390,'webgl'],
    [1366,768,'fallback'],[1366,768,'no-script'],[1366,768,'reduce']]) {
    const context = await browser.newContext({ viewport:{width,height}, javaScriptEnabled:mode!=='no-script',
      reducedMotion:mode==='reduce'?'reduce':'no-preference' });
    try {
      const target = await context.newPage(), errors = [];
      target.on('pageerror', error => errors.push(error.message));
      if (mode==='fallback') await target.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type,...args) {
          return String(type).includes('webgl') ? null : original.call(this,type,...args);
        };
      });
      await target.goto(origin);
      await target.bringToFront();
      if(mode!=='no-script') await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      if(mode==='webgl'||mode==='reduce') await target.waitForFunction(() => document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
      await target.mouse.move(width-5,5);
      await target.screenshot({path:`output/playwright/color-${mode}-${width}x${height}.png`});
      if(width>=1024) {
        for(const kind of ['blog','world','chest']) {
          const hit = target.locator(kind==='chest'?(mode==='no-script'?'#static-box':'#box-button'):`[data-entrance=${kind}] .entry-copy`);
          const bounds = await hit.boundingBox();
          await target.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
          const states = [];
          for(const [phase,delay] of [['start',0],['middle',kind==='chest'?420:320],['end',550]]) {
            if(delay) await target.waitForTimeout(delay);
            states.push(await target.evaluate(() => ({
              kind:document.querySelector('.staff-cursor-layer')?.dataset.cursorKind,
              reveal:document.querySelector('.staff-cursor-layer img[data-color-reveal]')?.dataset.colorReveal,
              fallback:[...document.querySelectorAll('.entry-color')].map(el=>getComputedStyle(el).getPropertyValue('--entry-color-progress')),
            })));
            await target.screenshot({path:`output/playwright/color-${mode}-${kind}-${phase}.png`});
          }
          if(mode!=='no-script') {
            assert(states[2].kind===(kind==='chest'?'grab':'point'),`${mode}/${kind}: 手势错误`);
            assert(Number(states[2].reveal)===1,`${mode}/${kind}: 复色未完成`);
            if(mode==='reduce') assert(Number(states[0].reveal)===1,'减少动态没有直接复色');
          }
          await target.mouse.move(width-5,5);
          if(kind!=='chest') {
            const reset=await target.locator(`[data-entrance=${kind}] .entry-color`).evaluate(el=>Number(getComputedStyle(el).getPropertyValue('--entry-color-progress')));
            assert(reset===0,`${kind}: 后备移出未立即归零`);
          }
          results.push({viewport:[width,height],mode,kind,states});
        }
        // 键盘聚焦同样点亮入口，移焦后清零；图标和文字仍属于同一个链接。
        await target.keyboard.press('Tab');
        await target.locator('[data-entrance=blog]').focus();
        await target.waitForTimeout(mode==='reduce'?50:780);
        const focus=await target.locator('[data-entrance=blog] .entry-color').evaluate(el=>Number(getComputedStyle(el).getPropertyValue('--entry-color-progress')));
        assert(focus===1,`${mode}: 键盘聚焦没有复色`);
      }
      assert(!errors.length,JSON.stringify(errors));
      results.push({viewport:[width,height],mode,errors});
    } finally { await context.close(); }
  }

  // 在揭幕前停住真实鼠标，逐 RAF 核对正确手势、热点、双层就绪与原生指针的同步交接。
  for(const position of ['blank','blog','world','chest','moving']) {
    const context=await browser.newContext({viewport:{width:1366,height:768}});
    let release;
    try {
      await context.addInitScript(() => {
        window.__handoff=[];
        document.addEventListener('DOMContentLoaded',()=>{
          let count=0;
          const sample=()=>{
            const layer=document.querySelector('.staff-cursor-layer'), loader=document.querySelector('#moon-loader');
            if(layer) window.__handoff.push({loader:!!loader,revealing:loader?.classList.contains('revealing'),hidden:layer.hidden,kind:layer.dataset.cursorKind,
              native:getComputedStyle(document.documentElement).cursor!=='none',
              images:[...layer.querySelectorAll('img')].map(img=>({complete:img.complete,width:img.naturalWidth,rect:[img.getBoundingClientRect().x,img.getBoundingClientRect().y]}))});
            if(loader||count++<12) requestAnimationFrame(sample);
          };requestAnimationFrame(sample);
        },{once:true});
      });
      const target=await context.newPage();
      const gate=new Promise(resolve=>{release=resolve;});
      await target.route(/\/assets\/scene-[^/]+\.js$/,async route=>{await gate;await route.continue();});
      await target.goto(origin,{waitUntil:'domcontentloaded'});await target.bringToFront();
      // 在放行前放好入口或空白处的指针；宝盒等待场景给出最终投影，避免依赖短暂的 revealing 选择器。
      if(position==='chest') {release();await target.waitForFunction(()=>document.querySelector('#scene').dataset.initialization);}
      const selector=position==='chest'?'#box-button':position==='blog'||position==='world'?`[data-entrance=${position}]`:null;
      const box=selector?await target.locator(selector).evaluate(el=>el.getBoundingClientRect().toJSON()):{x:600,y:100,width:20,height:20};
      const x=box.x+box.width/2,y=box.y+box.height/2;
      await target.mouse.move(x,y);
      release();
      let moving=position==='moving',step=0;
      const movement=(async()=>{while(moving){await target.mouse.move(x+(step++%12)*3,y+step%12);await target.waitForTimeout(20);}})();
      try {await target.waitForSelector('#app[data-state="idle"]:not([inert])');}
      finally {moving=false;await movement;}
      await target.waitForSelector('.staff-cursor-layer:not([hidden])');await target.waitForTimeout(240);
      const samples=await target.evaluate(()=>window.__handoff);
      const visible=samples.filter(item=>!item.loader&&!item.hidden);
      assert(samples.some(item=>item.revealing),`${position}: 没有记录到拉幕帧`);
      assert(samples.filter(item=>item.loader).every(item=>item.hidden&&item.native),`${position}: 幕内隐藏原生指针`);
      const expected=position==='chest'?'grab':position==='blog'||position==='world'?'point':'staff';
      assert(visible.length>0&&visible.every(item=>!item.native&&item.kind===expected&&item.images.every(img=>img.complete&&img.width===144)),`${position}: 揭幕交接帧错误 ${JSON.stringify({x,y,visible:visible.slice(0,6),hit:await target.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML.slice(0,200),{x,y})})}`);
      await target.screenshot({path:`output/playwright/handoff-${position}.png`});
      results.push({position,frames:samples.length,visibleFrames:visible.length,expected,samples:visible.slice(0,4)});
    } finally {release?.();await context.close();}
  }

  // 目标月夜图或原色图的解码失败，都必须保留该目标的原生手势，禁止临时显示金箍棒。
  for(const failed of ['cursor-point.png','cursor-point-color.png','cursor-grab.png']) {
    const context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
    try {
      await context.addInitScript(failed=>{
        const decode=HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode=function(){return this.src.endsWith(failed)?Promise.reject(new Error('controlled decode failure')):decode.call(this);};
      },failed);
      const target=await context.newPage();await target.goto(origin);await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      const selector=failed.includes('point')?'[data-entrance=blog]':'#box-button';
      await target.locator(selector).hover();
      const state=await target.locator(selector).evaluate(el=>({native:getComputedStyle(el).cursor,hidden:document.querySelector('.staff-cursor-layer').hidden}));
      assert(state.hidden&&state.native!=='none',`${failed}: 解码失败时未保留原生指针`);
      results.push({failed,...state});
    } finally {await context.close();}
  }
  return results;
}
