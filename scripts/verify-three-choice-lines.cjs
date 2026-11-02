// 用生产页面的真实动画时钟逐帧采样，并保存各阶段截图；不向页面添加可写场景接口。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const browser=page.context().browser(), origin=new URL(page.url()).origin, results=[];
  const stages=new Map([[320,'emerge'],[380,'left-emerge'],[440,'right-emerge'],[470,'back'],[560,'top'],[650,'front'],[850,'second-turn'],
    [1070,'two-turns'],[1140,'return'],[1220,'accelerating'],[1320,'inside'],[1370,'closed'],[1810,'rest']]);
  for (const [name,width,height] of [['desktop',1366,768],['phone',390,844],['short-phone',320,480]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'no-preference'});
    const target=await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; }), errors=[];
    target.on('pageerror',error=>errors.push(error.message));
    try {
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      // 加载完成后才控制时间，启动门禁和异步纹理生成仍走真实路径。
      await target.clock.install(); await target.clock.pauseAt(new Date(Date.now()+100));
      await target.locator('#box-button').click();
      // WAAPI 使用浏览器合成时钟；暂停并同步 currentTime，避免截图耗时提前触发 onfinish。
      await target.locator('.choice-motion').evaluate(el=>el.getAnimations()[0].pause());
      const samples=[], screenshots=[];
      for(let ms=0;ms<=1810;ms+=10) {
        if(ms) await target.clock.runFor(10);
        await target.locator('.choice-motion').evaluate((el,ms)=>{el.getAnimations()[0].currentTime=ms;},ms);
        const f=await target.locator('#scene').evaluate(el=>JSON.parse(el.dataset.choicePose));
        samples.push(f);
        if(stages.has(ms)) {
          if(ms<1800 && Math.abs(f.elapsed-ms)>25) throw new Error(`${name}: 截图未命中实际阶段 ${ms}/${f.elapsed}`);
          const file=`output/playwright/gold-${name}-${stages.get(ms)}.png`;
          await target.screenshot({path:file}); screenshots.push({ms,elapsed:f.elapsed,file});
        }
      }
      if(samples.some(f=>f.exposure!==1.05)) throw new Error(`${name}: 全局曝光改变`);
      const last=samples.at(-1);
      if(last.light!==0 || last.lid!==0 || last.yaw!==0 || last.roll!==0 || last.lift!==0)
        throw new Error(`${name}: 动画结束后未收净归位`);
      if(errors.length) throw new Error(JSON.stringify(errors));
      results.push({name,viewport:[width,height],samples:samples.length,screenshots,errors});
    } finally {await context.close();}
  }
  return results;
}
