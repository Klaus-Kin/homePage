// 草甸性能 self-review：检查分批初始化、重复缩放资源上界、真实帧间隔和完整释放。
// 需要 npm run dev 的页面地址：本脚本注入 /src/scene.ts 读取内部资源，不能在生产预览上执行。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin=new URL(page.url()).origin;
  const context=await page.context().browser().newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  // 同步生成是否阻塞由浏览器记录，不用包含 Worker 等待的检查点墙钟替代 CPU 长任务。
  await context.addInitScript(() => {
    window.__meadowLongTasks = [];
    new PerformanceObserver(list => window.__meadowLongTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))))
      .observe({ type: "longtask", buffered: true });
  });
  const target=await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; });
  try {
    await target.route(/\/src\/scene\.ts(?:\?|$)/,async route=>{
      const response=await route.fetch(),source=await response.text();
      const body=source.replace('const firstSubmit = performance.now();',
        'window.__performanceReview={renderer,terrain,dispose,init}; const firstSubmit = performance.now();');
      if(body===source)throw new Error('性能验收注入失败');
      await route.fulfill({response,body});
    });
    const cdp=await context.newCDPSession(target);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await target.goto(origin);
    await target.waitForSelector('#app[data-state="idle"]',{timeout:60000});
    const initialization=await target.evaluate(()=>{
      const data=JSON.parse(document.querySelector('#scene').dataset.initialization);
      const batches=data.batches.filter((_,i)=>data.phases[i].startsWith('meadow-'));
      const start=performance.getEntriesByName('moon-generation-start')[0]?.startTime,
        end=performance.getEntriesByName('moon-generation-end')[0]?.startTime;
      return {meadowBatches:batches.length,maximumMeadowBatchWallMs:Math.max(...batches),firstSubmitMs:data.firstSubmitMs,
        // 任务可能先于阶段标记开始，按区间交集统计，不能遗漏跨边界的主线程阻塞。
        generationLongTasks:window.__meadowLongTasks.filter(task=>task.start+task.duration>start&&task.start<end)};
    });
    if(initialization.generationLongTasks.length)throw new Error(`生成阶段存在浏览器长任务：${JSON.stringify(initialization)}`);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    const resources=[];
    for(let i=0;i<4;i++) {
      for(const [width,height] of [[393,852],[1440,900]]) {
        await target.setViewportSize({width,height});
        await target.waitForTimeout(180);
      }
      resources.push(await target.evaluate(()=>({...window.__performanceReview.renderer.info.memory})));
    }
    if(resources.slice(1).some(r=>r.geometries!==resources[0].geometries || r.textures!==resources[0].textures))
      throw new Error(`缩放后 GPU 资源增长：${JSON.stringify(resources)}`);
    await target.emulateMedia({reducedMotion:'no-preference'});
    const frameTiming=await target.evaluate(()=>new Promise(resolve=>{
      const times=[]; let previous;
      const sample=time=>{if(previous!==undefined)times.push(time-previous);previous=time;
        if(times.length<90)requestAnimationFrame(sample);
        else {times.sort((a,b)=>a-b);resolve({medianMs:times[45],p95Ms:times[85]});}};
      requestAnimationFrame(sample);
    }));
    const disposal=await target.evaluate(()=>{
      const {renderer,dispose,init}=window.__performanceReview;
      const gl=renderer.getContext();dispose();
      return {canvasRemoved:!document.querySelector('#scene canvas'),trackedResources:init.resources.size,contextLost:gl.isContextLost()};
    });
    if(!disposal.canvasRemoved || disposal.trackedResources || !disposal.contextLost)throw new Error(JSON.stringify(disposal));
    return {initialization,resources,frameTiming,disposal,environment:'桌面 Chromium，手机为视口模拟'};
  } finally {await context.close();}
}
