// 真实 RAF 采样提示前后及重复播放的 GPU 资源；手机是桌面浏览器模拟，报告不代表真机帧率。
async (page) => {
  const results = [], browser = page.context().browser(), origin = new URL(page.url()).origin;
  for (const [width,height] of [[1366,768],[390,844]]) {
    const context = await browser.newContext({viewport:{width,height}}), target = await context.newPage(), errors=[];
    try {
      target.on('pageerror',error=>errors.push(error.message));
      await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      // 首轮也记录帧间隔与动作阶段，避免预热掩盖新灯光首次编译造成的停顿。
      let baseline;
      const plays=[];
      for (let play=0;play<4;play++) {
        await target.locator('#box-button').click();
        const metrics = await target.evaluate(()=>new Promise(resolve=>{
          const host=document.querySelector('#scene'), intervals=[], resources=[], phases={opening:0,orbit:0,return:0,impact:0};
          let previous=performance.now();
          function sample(now) {
            intervals.push(now-previous); previous=now;
            const f=JSON.parse(host.dataset.choicePose);
            if(f.elapsed<300) phases.opening++;
            else if(f.elapsed<1050) phases.orbit++;
            else if(f.elapsed<1350) phases.return++;
            else if(f.elapsed<1800) phases.impact++;
            if (f.light>0) resources.push(JSON.parse(host.dataset.resources));
            if (document.querySelector('#journey-choices').dataset.prompt==='true') requestAnimationFrame(sample);
            else {
              intervals.sort((a,b)=>a-b);
              resolve({medianMs:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],
                maxMs:intervals.at(-1),phases,frames:intervals.length,active:resources.at(-1),rest:JSON.parse(host.dataset.resources)});
            }
          }
          requestAnimationFrame(sample);
        }));
        plays.push(metrics);
        if(play===0) baseline=metrics.rest;
        if(Object.values(metrics.phases).some(count=>count===0)) throw new Error(`首次或重复播放跳过完整阶段 ${JSON.stringify({play,metrics})}`);
      }
      if (plays.some(p=>!p.active || p.active.geometries>baseline.geometries || p.active.textures>baseline.textures))
        throw new Error(`提示创建了额外资源 ${JSON.stringify({baseline,plays})}`);
      if (plays.some(p=>p.rest.geometries!==plays[0].rest.geometries || p.rest.textures!==plays[0].rest.textures))
        throw new Error(`重复提示累积 GPU 资源 ${JSON.stringify(plays)}`);
      if (errors.length) throw new Error(JSON.stringify(errors));
      results.push({viewport:[width,height],baseline,plays,errors});
    } finally {await context.close();}
  }
  return results;
}
