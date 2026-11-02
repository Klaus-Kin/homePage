// 通过 playwright-cli run-code --filename 执行；覆盖旋转、工具栏等效高度变化、开盒和静态热点。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin, browser = page.context().browser(), results = [];
  const sizes = [[1672,941],[1920,1080],[768,1024],[390,844],[320,480],[844,390]];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const context = await browser.newContext({hasTouch:true, reducedMotion:'reduce'});
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; });
    await target.goto(origin);
    await target.waitForSelector('#app[data-state="idle"]:not([inert])');
    // 连续缩放经过手机、横屏及临界高度，再回到原尺寸，检查相机、热点及资源恢复。
    for (const [width,height] of [...sizes,[390,740],[390,844],[844,390],[390,844]]) {
      await target.setViewportSize({width,height});
      await target.waitForTimeout(250);
      const data = await target.evaluate(() => {
        const scene=document.querySelector('#scene'), box=document.querySelector('#box-button');
        const b=JSON.parse(scene.dataset.boxBounds), r=box.getBoundingClientRect();
        const links=[...document.querySelectorAll('[data-entrance]')].map(link => {
          const r=link.getBoundingClientRect();
          return {width:r.width,height:r.height,right:r.right,bottom:r.bottom,
            hit:link.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
        });
        const blocked=[];
        for(const x of [.1,.5,.9])for(const y of [.1,.5,.9])
          if(!box.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))) blocked.push([x,y]);
        return {b,links,blocked,scroll:document.documentElement.scrollWidth>innerWidth,
          viewHeight:document.querySelector('#app').clientHeight,resources:JSON.parse(scene.dataset.resources)};
      });
      assert(!data.scroll && !data.blocked.length && data.viewHeight===height, `缩放或热点异常 ${JSON.stringify(data)}`);
      assert(data.links.every(r=>r.hit&&r.width>=44&&r.height>=44&&r.right<=width&&r.bottom<=height), '入口出界或不可点击');
      assert(data.b.left>=0&&data.b.top>=0&&data.b.right<=width&&data.b.bottom<=height, '缩放后宝盒被裁切');
      results.push({mode:'resize',width,height,passed:true});
    }
    // 同一动画时钟逐段检查真正的开盖，不修改场景公共 API 或旅程时长。
    for(const [width,height] of sizes){
      await target.setViewportSize({width,height});
      await target.emulateMedia({reducedMotion:'no-preference'});
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.clock.install();
      await target.clock.pauseAt(new Date(Date.now()+100));
      await target.locator('[data-entrance=blog]').tap();
      for(let step=0;step<11;step++){
        await target.clock.runFor(80);
        const data=await target.locator('#scene').evaluate(el=>({b:JSON.parse(el.dataset.boxBounds),lid:+el.dataset.lidAngle}));
        assert(data.b.left>=0&&data.b.top>=0&&data.b.right<=width&&data.b.bottom<=height,`开盖出界 ${width}x${height} ${JSON.stringify(data)}`);
        if(step===5) await target.screenshot({path:`output/playwright/opening-${width}x${height}.png`});
        if(step===10) assert(data.lid===180,'上盖未完整展开');
      }
      await target.clock.resume();
      results.push({mode:'opening',width,height,passed:true});
    }
  } finally {await context.close();}
  // WebGL 故障和无脚本均使用最终导出的同一套降级图，逐个尺寸检查真实点击区域。
  for(const mode of ['no-js','no-webgl']){
    const c=await browser.newContext({javaScriptEnabled:mode!=='no-js',reducedMotion:'reduce'});
    try{
      const target=await c.newPage().then(async target => { await c.addInitScript(() => { window.__moonDiagnostics = true; }); return target; });
      if(mode==='no-webgl')await target.addInitScript(()=>{
        const get=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:get.call(this,type,...args);};
      });
      for(const [width,height] of sizes){
        await target.setViewportSize({width,height});await target.goto(origin);
        if(mode==='no-webgl')await target.waitForSelector('#app.fallback[data-state="idle"]:not([inert])');
        const data=await target.evaluate(()=>{
          const box=document.querySelector(getComputedStyle(document.querySelector('#box-button')).display==='none'?'#static-box':'#box-button');
          const r=box.getBoundingClientRect();
          return {r:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},
            hit:box.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
            links:[...document.querySelectorAll('[data-entrance]')].map(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height,bottom:b.bottom};}),
            image:getComputedStyle(document.querySelector('.scene-fallback')).backgroundImage,
            scroll:document.documentElement.scrollWidth>innerWidth};
        });
        assert(data.hit&&!data.scroll&&data.r.width>=44&&data.r.height>=44,'静态热点不可点击');
        if(height<500&&width<height) assert(data.image.includes('scene-short-portrait.webp'), '短竖屏仍错误裁切横屏图');
        assert(data.links.every(r=>r.width>=44&&r.height>=44&&r.bottom<=height),'静态入口裁切');
        await target.screenshot({path:`output/playwright/${mode}-${width}x${height}.png`});
        results.push({mode,width,height,passed:true});
      }
    }finally{await c.close();}
  }
  return results;
}
