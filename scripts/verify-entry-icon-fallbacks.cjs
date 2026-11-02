// 图标故障与主场景隔离；无脚本、延迟导入及高对比模式都保留原有静态链接。
async (page) => {
  // 从当前服务的静态入口读取实际地址；独立无脚本文档不会启动额外的 WebGL 场景。
  const linkContext = await page.context().browser().newContext({ javaScriptEnabled: false });
  let destinations;
  try {
    const links = await linkContext.newPage();
    await links.goto(new URL(page.url()).origin);
    destinations = await links.locator("[data-entrance]").evaluateAll(links =>
      Object.fromEntries(links.map(link => [link.dataset.entrance, link.href])));
  } finally { await linkContext.close(); }
  const browser=page.context().browser(),origin=new URL(page.url()).origin,results=[];
  const assert=(value,message)=>{if(!value) throw new Error(message);};
  for(const mode of ['no-webgl','icons-no-webgl','context-loss','draw-failure','module-delay','module-failure','no-script','forced-colors','boot-timeout']) {
    const context=await browser.newContext({viewport:{width:390,height:844},javaScriptEnabled:mode!=='no-script',
      forcedColors:mode==='forced-colors'?'active':'none',reducedMotion:'reduce'});
    const target=await context.newPage(),errors=[];
    // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
    await context.route("**/*", route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    target.on('pageerror',error=>errors.push(error.message));
    try {
      if(mode==='no-webgl'||mode==='icons-no-webgl') await target.addInitScript(onlyIcons=>{
        const original=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args){
          if(/webgl/.test(type)&&(!onlyIcons||this.classList.contains('entry-canvas'))) return null;
          return original.call(this,type,...args);
        };
      },mode==='icons-no-webgl');
      if(mode==='draw-failure') await target.addInitScript(()=>{
        const original=WebGL2RenderingContext.prototype.drawElements;
        WebGL2RenderingContext.prototype.drawElements=function(...args){
          if(window.__breakEntryRender&&this.canvas.closest('[data-entrance=world]')) throw new Error('验收：入口绘制失败');
          return original.apply(this,args);
        };
      });
      if(mode==='module-failure') await target.route(/\/(?:src\/entry-icons\.ts|assets\/entry-icons-[^/]+\.js)(?:\?|$)/,route=>route.abort());
      let release;
      if(mode==='module-delay') await target.route(/\/(?:src\/entry-icons\.ts|assets\/entry-icons-[^/]+\.js)(?:\?|$)/,async route=>{
        await new Promise(resolve=>{release=resolve;});await route.continue();
      });
      if(mode==='boot-timeout') await target.route(/\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/,async route=>{
        await new Promise(resolve=>{release=resolve;});await route.continue();
      });
      await target.goto(origin);
      if(mode!=='no-script') await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      if(mode==='module-delay') {
        await target.waitForFunction(()=>document.querySelectorAll('.entry-canvas').length===0);
        assert(await target.locator('.entry-fallback').evaluateAll(icons=>icons.every(el=>getComputedStyle(el).visibility==='visible')),'模块加载前原图被隐藏');
        for(let i=0;i<30&&!release;i++) await target.waitForTimeout(50);
        assert(!!release,'没有捕获图标模块请求');release();
        await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
      } else if(mode==='context-loss'||mode==='draw-failure') {
        await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
        if(mode==='context-loss') await target.locator('[data-entrance=world] canvas').evaluate(canvas=>canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
        else {await target.evaluate(()=>{window.__breakEntryRender=true;});await target.locator('[data-entrance=world]').focus();}
        await target.waitForFunction(()=>!document.querySelector('[data-entrance=world] canvas'));
        assert(await target.locator('[data-entrance=blog] .entry-icon').getAttribute('data-model-ready')==='true','一个图标故障影响另一图标');
        assert(await target.locator('.monkey-face').evaluate(el=>getComputedStyle(el).visibility==='visible'),'故障后猴头后备未恢复');
      } else if(mode==='boot-timeout') {
        assert(await target.locator('#app').evaluate(el=>el.classList.contains('boot-failed')),'没有触发真实启动超时');
        assert(!!release,'没有捕获迟到的场景模块');release();
        await target.waitForTimeout(500);
        assert(await target.locator('.entry-canvas').count()===0,'超时后迟到模块重新创建了图标');
      } else {
        if(mode!=='no-script') await target.waitForTimeout(500);
        assert(await target.locator('.entry-fallback').evaluateAll(icons=>icons.every(el=>getComputedStyle(el).visibility==='visible')),'后备图不可见');
      }
      assert(await target.locator('[data-entrance=blog]').getAttribute('href')===destinations.blog,'博客目的地改变');
      assert(await target.locator('[data-entrance=world]').getAttribute('href')===destinations.world,'世界目的地改变');
      assert(await target.locator('.entry-icon').evaluateAll(slots=>slots.every(el=>getComputedStyle(el).pointerEvents==='none')),'图标拦截点击');
      if(mode==='icons-no-webgl') assert(await target.locator('#app').evaluate(el=>!el.classList.contains('fallback')),'图标故障拖累主场景');
      await target.screenshot({path:`output/playwright/entry-icons-${mode}.png`});
      assert(errors.length===0,JSON.stringify(errors));
      results.push({mode,passed:true});
    } finally {await context.close();}
  }
  return results;
}
