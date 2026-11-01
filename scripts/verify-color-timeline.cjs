// 生产预览中用受控时钟冻结复色起点、中段和终点；只检查交互时间，不用墙钟截图耗时推断进度。
async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1920,height:1080}});
  const results=[];
  const assert=(value,message)=>{if(!value) throw new Error(message);};
  try {
    const target=await context.newPage();await target.goto(new URL(page.url()).origin);await target.bringToFront();
    await target.waitForSelector('#app[data-state="idle"]:not([inert])');
    await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
    await target.mouse.move(900,100);
    await target.clock.install();await target.clock.pauseAt(new Date(Date.now()+100));
    const read=()=>target.evaluate(()=>({
      cursor:Number(document.querySelector('.staff-cursor-layer img[data-color-reveal]')?.dataset.colorReveal ?? 0),
      kind:document.querySelector('.staff-cursor-layer').dataset.cursorKind,
      icons:[...document.querySelectorAll('.entry-icon')].map(el=>Number(el.dataset.colorReveal??0)),
    }));
    for(const kind of ['blog','world','chest']) {
      const selector=kind==='chest'?'#box-button':`[data-entrance=${kind}] .entry-copy`;
      const box=await target.locator(selector).boundingBox();
      await target.mouse.move(box.x+box.width/2,box.y+box.height/2);
      const duration=kind==='chest'?900:700, snapshots=[];
      for(const [phase,advance] of [['start',0],['middle',duration/2],['end',duration/2+20]]) {
        if(advance) await target.clock.runFor(advance);
        const state=await read();snapshots.push({phase,...state});
        if(phase==='start') assert(state.cursor<.05,`${kind}: 重入未从底部开始`);
        if(phase==='middle') {
          assert(state.cursor>.45&&state.cursor<.55,`${kind}: 中段时长错误 ${JSON.stringify(state)}`);
          if(kind!=='chest') assert(Math.abs(state.cursor-state.icons[kind==='blog'?0:1])<.03,'手指与图标复色未同步');
        }
        if(phase==='end') assert(state.cursor===1,`${kind}: 终点未完全复色`);
        await target.screenshot({path:`output/playwright/timeline-${kind}-${phase}.png`});
      }
      if(kind!=='chest') {
        const icon=await target.locator(`[data-entrance=${kind}] .entry-icon`).boundingBox();
        await target.mouse.move(icon.x+icon.width/2,icon.y+icon.height/2);await target.clock.runFor(32);
        assert((await read()).cursor===1,'文字移到同入口图标时错误重播');
      }
      await target.mouse.move(900,100);await target.clock.runFor(32);
      const reset=await read();assert(reset.kind==='staff'&&reset.icons.every(value=>value===0),'移出没有立即恢复月夜色');
      results.push({kind,snapshots});
    }
    // 直接跨入口不能沿用同一种手指的旧进度。
    for(const kind of ['blog','world','blog']) {
      const box=await target.locator(`[data-entrance=${kind}] .entry-copy`).boundingBox();
      await target.mouse.move(box.x+box.width/2,box.y+box.height/2);
      assert((await read()).cursor<.05,`${kind}: 跨入口没有重新开始`);
      await target.clock.runFor(200);
    }
    return results;
  } finally {await context.close();}
}
