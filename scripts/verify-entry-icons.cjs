// 真实浏览器连续观察三档尺寸；截图与 GPU 调用计数共同验证可视效果和按需绘制。
async (page) => {
  const browser=page.context().browser(),origin=new URL(page.url()).origin,results=[];
  const assert=(value,message)=>{if(!value) throw new Error(message);};
  for(const [width,height,size] of [[1366,768,44],[390,844,36],[640,500,30]]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:3});
    const target=await context.newPage(),errors=[];
    target.on('pageerror',error=>errors.push(error.message));
    try {
      await target.addInitScript(()=>{
        window.__entryGPU=[];
        const original=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args) {
          const gl=original.call(this,type,...args);
          if(gl && /webgl/.test(type) && this.classList.contains('entry-canvas') && !gl.__entryInstrumented) {
            gl.__entryInstrumented=true;
            const stats={created:0,deleted:0,draws:0,programs:0,deletedPrograms:0};
            window.__entryGPU.push(stats);
            for(const [name,key] of [['createBuffer','created'],['deleteBuffer','deleted'],['drawElements','draws'],['drawArrays','draws'],['createProgram','programs'],['deleteProgram','deletedPrograms']]) {
              const method=gl[name];gl[name]=function(...values){stats[key]++;return method.apply(this,values);};
            }
          }
          return gl;
        };
      });
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
      await target.mouse.move(width-5,5);
      const baseline=await target.locator('[data-entrance]').evaluateAll(links=>links.map(link=>({
        width:link.querySelector('.entry-icon').getBoundingClientRect().width,
        x:link.getBoundingClientRect().x,y:link.getBoundingClientRect().y,
        canvas:link.querySelector('canvas').width,
      })));
      assert(baseline.every(b=>b.width===size && b.canvas<=Math.ceil(size*1.6)*2),'占位尺寸或 DPR 上限错误');
      // 同一入口分别保留静止和红眼截图，便于核对大眼瞳孔、发际线和红丝固定根点。
      await target.screenshot({path:`output/playwright/monkey-${size}px-rest.png`});
      await target.locator('[data-entrance=world] .entry-icon').screenshot({path:`output/playwright/monkey-${size}px-rest-detail.png`});
      await target.keyboard.press('Tab');
      await target.locator('[data-entrance=world]').focus();
      await target.locator('[data-entrance=blog]').hover();
      await target.waitForTimeout(1300);
      const gpu=await target.evaluate(()=>window.__entryGPU.map(s=>({...s})));
      await target.screenshot({path:`output/playwright/entry-icons-${size}px.png`});
      await target.locator('#journey-choices').screenshot({path:`output/playwright/entry-icons-${size}px-detail.png`});
      await target.locator('[data-entrance=world] .entry-icon').screenshot({path:`output/playwright/monkey-${size}px-active-detail.png`});
      // 采样持续十五秒，包含多个 2.8/3–5 秒周期；同一父容器承载中英文，子层无动画。
      const samples=await target.evaluate(()=>new Promise(resolve=>{
        const start=performance.now(),samples=[];
        function sample(now) {
          samples.push([...document.querySelectorAll('[data-entrance]')].map(link=>{
            const copy=link.querySelector('.entry-copy'),matrix=new DOMMatrix(getComputedStyle(copy).transform);
            return {active:link.dataset.entryActive,x:matrix.m41,y:matrix.m42,frames:+link.querySelector('.entry-icon').dataset.frames,
              childTransform:getComputedStyle(copy.querySelector('small')).transform};
          }));
          if(now-start<15000) setTimeout(()=>requestAnimationFrame(sample),100);else resolve(samples);
        }
        requestAnimationFrame(sample);
      }));
      assert(samples.every(s=>s.every(v=>v.active==='true'&&v.childTransform==='none')),'双入口不能持续独立激活或英文发生二次位移');
      assert(Math.max(...samples.map(s=>s[0].y))>1.9&&Math.min(...samples.map(s=>s[0].y))< -1.9,'第一项未持续上下浮动');
      assert(Math.max(...samples.map(s=>s[1].x))>2.9&&Math.min(...samples.map(s=>s[1].x))<.1,'第二项未持续水平往返');
      for(let i=1;i<samples.length;i++) for(let j=0;j<2;j++) {
        const a=samples[i-1][j],b=samples[i][j];
        assert(Math.abs(a.x-b.x)<1.5&&Math.abs(a.y-b.y)<1.5,'文字循环发生跳变');
        assert(b.frames>a.frames,'激活期间停止绘制');
      }
      const after=await target.evaluate(()=>window.__entryGPU);
      assert(after.every((s,i)=>s.created===gpu[i].created&&s.programs===gpu[i].programs),'循环创建 GPU 缓冲或着色器');
      await target.locator('[data-entrance=world]').evaluate(el=>el.blur());
      await target.waitForTimeout(550);
      const independent=await target.locator('.entry-icon').evaluateAll(slots=>slots.map(el=>+el.dataset.frames));
      await target.waitForTimeout(250);
      assert(await target.locator('.entry-icon').evaluateAll((slots,before)=>+slots[0].dataset.frames>before[0]&&+slots[1].dataset.frames===before[1],independent),'退出一项影响另一项，或退出后仍在绘制');
      await target.mouse.move(width-5,5);
      await target.waitForTimeout(550);
      const rest=await target.locator('.entry-icon').evaluateAll(slots=>slots.map(el=>+el.dataset.frames));
      await target.waitForTimeout(250);
      assert(await target.locator('.entry-icon').evaluateAll((slots,before)=>slots.every((el,i)=>+el.dataset.frames===before[i]),rest),'静止状态没有停止绘制');
      assert(await target.locator('.entry-copy').evaluateAll(copies=>copies.every(el=>el.style.transform==='none')),'退出未精确归位');
      const bounds=await target.locator('[data-entrance]').evaluateAll(links=>links.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
      assert(bounds.every((b,i)=>b.x===baseline[i].x&&b.y===baseline[i].y),'入口布局产生偏移');
      // 页面隐藏后 RAF 和位移冻结；恢复首帧不计入隐藏时间。
      await target.locator('[data-entrance=world]').hover();await target.waitForTimeout(1400);
      const paused=await target.evaluate(()=>{
        Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
        return {frames:document.querySelector('[data-entrance=world] .entry-icon').dataset.frames,transform:document.querySelector('.journey-copy').style.transform};
      });
      await target.waitForTimeout(350);
      assert(await target.evaluate(p=>document.querySelector('[data-entrance=world] .entry-icon').dataset.frames===p.frames&&document.querySelector('.journey-copy').style.transform===p.transform,paused),'后台动画未暂停');
      await target.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
      await target.emulateMedia({reducedMotion:'reduce'});await target.waitForTimeout(1300);
      const reduced=await target.locator('.entry-icon').evaluateAll(slots=>slots.map(el=>+el.dataset.frames));
      await target.screenshot({path:`output/playwright/entry-icons-${size}px-reduced.png`});
      await target.waitForTimeout(300);
      assert(await target.locator('.entry-icon').evaluateAll((slots,before)=>slots.every((el,i)=>+el.dataset.frames===before[i]),reduced),'减少动态仍有循环绘制');
      assert(await target.locator('.entry-copy').evaluateAll(copies=>copies.every(el=>el.style.transform==='none')),'减少动态仍有文字位移');
      // 离页事件必须移除画布，并释放全部已创建的入口缓冲和程序。
      await target.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
      assert(await target.locator('.entry-canvas').count()===0,'离页没有移除画布');
      const released=await target.evaluate(()=>window.__entryGPU);
      assert(released.every(s=>s.created===s.deleted&&s.programs===s.deletedPrograms),'入口 GPU 资源未完整释放');
      assert(errors.length===0,JSON.stringify(errors));
      results.push({viewport:[width,height],iconSize:size,samples:samples.length,frames:samples.at(-1).map(s=>s.frames),gpu:released,errors});
    } finally {await context.close();}
  }
  return results;
}
