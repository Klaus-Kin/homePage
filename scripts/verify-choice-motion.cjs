// 对生产构建使用真实可见时间采样；暂停页面后截图，避免截图等待跨过短暂的合盖/冲击阶段。
async (page) => {
  const browser = page.context().browser(), origin = new URL(page.url()).origin, results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  async function setup(viewport = {width:1366,height:768}, reducedMotion = 'no-preference') {
    const context = await browser.newContext({viewport, reducedMotion});
    const target = await context.newPage(), errors = [], navigations = [];
    target.on('pageerror', error => errors.push(error.message));
    for (const destination of ['https://example.com/blog', 'https://example.org/']) await target.route(destination, async route => {
      navigations.push(destination); await route.fulfill({contentType:'text/html', body:'<h1>到达</h1>'});
    });
    await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
    assert(await target.locator('#scene canvas').count() === 1, '验收必须使用真实 WebGL 场景');
    return {context,target,errors,navigations};
  }
  const sample = target => target.evaluate(() => {
    const host = document.querySelector('#scene'), motion = document.querySelector('.choice-motion');
    return { ...JSON.parse(host.dataset.choicePose), lidDegrees:+host.dataset.lidAngle,
      bounds:JSON.parse(host.dataset.boxBounds), hit:document.querySelector('#box-button').getBoundingClientRect().toJSON(),
      moon:JSON.parse(host.dataset.moonBounds),
      x:new DOMMatrix(getComputedStyle(motion).transform).m41,
      beams:host.dataset.beamsVisible, spread:+(document.querySelector('#whiteout').dataset.spread || 0),
      prompt:document.querySelector('#journey-choices').dataset.prompt,
      resources:JSON.parse(host.dataset.resources), frames:+host.dataset.frames };
  });
  const wait = (target, ms) => target.waitForFunction(ms => JSON.parse(document.querySelector('#scene').dataset.choicePose).elapsed >= ms, ms);
  const freeze = target => target.evaluate(() => {
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange'));
  });
  const resume = target => target.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  // 遍历关键响应式尺寸及每个动作阶段，同时检查入口命中、模型边界和正式光效隔离。
  for (const [width,height] of [[1366,768],[390,844],[640,600],[1100,1000],[1920,601],[768,721],[800,721],[768,841],[320,480]]) {
    const s = await setup({width,height});
    try {
      const baseline = await sample(s.target), stages = [];
      assert(baseline.moon.left>=0 && baseline.moon.top>=0 && baseline.moon.right<=width && baseline.moon.bottom<=height,
        `${width}x${height}: 初始月球被裁切 ${JSON.stringify(baseline.moon)}`);
      await s.target.locator('#box-button').click();
      for (const [name,ms] of [['opening',150],['orbit-front',520],['orbit-back',860],['pull',1130],['closing',1290],['impact',1430],['settle',1660],['rest',1820]]) {
        // 结束后采样器固定返回 1800；其余阶段暂停不改变已经累计的进度。
        if (name === 'rest') await s.target.waitForSelector('#journey-choices:not([data-prompt])');
        else await wait(s.target, ms);
        await freeze(s.target);
        const f = await sample(s.target);
        assert(f.beams==='false' && f.spread===0 && f.exposure===1.05, `${width}x${height}/${name}: 提示泄漏到正式光效`);
        assert(Math.abs(f.moon.top-baseline.moon.top)<3 && Math.abs(f.moon.left-baseline.moon.left)<3,
          `${width}x${height}/${name}: 提示退让改变了月球构图`);
        assert(f.bounds.left>=0 && f.bounds.top>=0 && f.bounds.right<=width && f.bounds.bottom<=height,
          `${width}x${height}/${name}: 宝盒裁切 ${JSON.stringify(f.bounds)}`);
        assert(f.hit.x<=f.bounds.left && f.hit.y<=f.bounds.top && f.hit.right>=f.bounds.right && f.hit.bottom>=f.bounds.bottom,
          `${width}x${height}/${name}: 点击区未跟随姿态`);
        const entries = await s.target.evaluate(() => [...document.querySelectorAll('[data-entrance]')].map(el => {
          const r=el.getBoundingClientRect(),box=document.querySelector('#box-button').getBoundingClientRect();
          return {rect:r.toJSON(),hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
            clipped:r.x<0 || r.y<0 || r.right>innerWidth || r.bottom>innerHeight,
            overlap:r.x<box.right && r.right>box.x && r.y<box.bottom && r.bottom>box.y};
        }));
        if (entries.some(e=>e.clipped || !e.hit || e.overlap)) {
          await s.target.screenshot({path:`output/playwright/choice-motion-failed-${width}x${height}-${name}.png`});
          throw new Error(`${width}x${height}/${name}: 入口裁切或覆盖宝盒 ${JSON.stringify({entries,frame:f})}`);
        }
        if (ms>=750) assert(Math.abs(f.x)<.01, `${name}: 720ms 后文字仍在移动`);
        if (name==='rest') assert(f.lid===0 && f.yaw===0 && f.roll===0 && f.pitch===0 && f.groundedY===0 && f.light===0,
          '结束未精确归位');
        if ([1366,390,1920,768,800].includes(width)) await s.target.screenshot({path:`output/playwright/choice-motion-${width}x${height}-${name}.png`});
        stages.push({name,...f});
        await resume(s.target);
      }
      assert(s.errors.length===0, JSON.stringify(s.errors));
      results.push({viewport:[width,height],baseline,stages});
    } finally { await s.context.close(); }
  }
  // 各阶段接受入口都必须同步清除光效和全部姿态，第二入口点击不得改写首次锁定的目标。
  for (const [ms,entry,url] of [[150,'blog','https://example.com/blog'],[620,'world','https://example.org/'],[1170,'blog','https://example.com/blog'],[1480,'world','https://example.org/']]) {
    const s = await setup();
    try {
      await s.target.locator('#box-button').click(); await wait(s.target,ms);
      const accepted = await s.target.evaluate(entry => {
        document.querySelector(`[data-entrance=${entry}]`).click();
        document.querySelector(`[data-entrance=${entry==='blog'?'world':'blog'}]`).click();
        const host=document.querySelector('#scene');
        return {...JSON.parse(host.dataset.choicePose), lidDegrees:+host.dataset.lidAngle,
          state:document.querySelector('#app').dataset.state, transform:getComputedStyle(document.querySelector('.choice-motion')).transform};
      },entry);
      assert(accepted.lidDegrees===0 && accepted.yaw===0 && accepted.roll===0 && accepted.pitch===0 && accepted.groundedY===0 && accepted.light===0 &&
        accepted.transform==='none' && accepted.state==='transition', `阶段 ${ms}ms 取消未归位: ${JSON.stringify(accepted)}`);
      await s.target.emulateMedia({reducedMotion:'reduce'});
      await s.target.waitForURL(url);
      assert(s.navigations.length===1 && s.errors.length===0,'阶段选择后导航锁定失效');
      results.push({cancelAt:ms,entry,accepted,navigations:s.navigations});
    } finally { await s.context.close(); }
  }
  // 暂停、变更尺寸和偏好切换都只改变当前播放状态，不得重播或补算后台时间。
  const s = await setup();
  try {
    await s.target.locator('#box-button').click(); await wait(s.target,600); await freeze(s.target);
    const paused = await sample(s.target); await s.target.waitForTimeout(300);
    const still = await sample(s.target);
    assert(still.frames===paused.frames && still.elapsed===paused.elapsed,'后台继续播放或渲染');
    await resume(s.target); await s.target.setViewportSize({width:768,height:721});
    const resized = await sample(s.target);
    assert(resized.elapsed>=paused.elapsed && resized.elapsed-paused.elapsed<250 && resized.lidDegrees>25.9,'尺寸变化重播或污染基准');
    // CDP 设置偏好与 DOM 的 change 事件异步交付，先监听实际事件再检查处理后的首帧。
    await s.target.evaluate(()=>{
      window.__choiceMotionChanged=new Promise(resolve=>matchMedia('(prefers-reduced-motion: reduce)')
        .addEventListener('change',()=>requestAnimationFrame(resolve),{once:true}));
    });
    await s.target.emulateMedia({reducedMotion:'reduce'});
    await s.target.evaluate(()=>window.__choiceMotionChanged);
    const reduced = await sample(s.target);
    assert(reduced.light===0 && reduced.lidDegrees===0 && reduced.yaw===0 && reduced.groundedY===0,`开启减少动态未立即归位 ${JSON.stringify(reduced)}`);
    await s.target.emulateMedia({reducedMotion:'no-preference'}); await s.target.waitForTimeout(150);
    const switchedBack = await sample(s.target);
    assert(switchedBack.light===0 && switchedBack.lidDegrees===0 && switchedBack.yaw===0 && switchedBack.x===0,'切回偏好重播了提示');
    await s.target.waitForSelector('#journey-choices:not([data-prompt])');
    assert(s.errors.length===0,JSON.stringify(s.errors));
    results.push({lifecycle:{paused,resized,reduced,switchedBack}});
  } finally { await s.context.close(); }
  const r = await setup({width:390,height:844},'reduce');
  try {
    await r.target.locator('#box-button').click();
    const duration = await r.target.locator('.choice-motion').evaluate(el=>el.getAnimations()[0].effect.getTiming().duration);
    assert(duration===720,'减少动态改变原 720ms 提示时长');
    const frame=await sample(r.target);
    assert(frame.light===0 && frame.lidDegrees===0 && frame.yaw===0 && frame.groundedY===0,'减少动态播放运动光效');
    results.push({reducedDuration:duration});
  } finally { await r.context.close(); }
  // 运行中丢失 WebGL 时释放运动资源并回到原文字窗口；离页则连同动画引用一起清空。
  const lost=await setup();
  try {
    await lost.target.locator('#box-button').click(); await wait(lost.target,450);
    await lost.target.evaluate(()=>document.querySelector('#scene canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await lost.target.waitForSelector('#app.fallback');
    const fallback=await lost.target.locator('.choice-motion').evaluate(el=>({
      duration:el.getAnimations()[0]?.effect.getTiming().duration,canvas:document.querySelectorAll('#scene canvas').length}));
    assert(fallback.duration===720 && fallback.canvas===0,'播放中降级未释放场景或未恢复文字时长');
    await lost.target.waitForSelector('#journey-choices:not([data-prompt])');
    assert(lost.errors.length===0,JSON.stringify(lost.errors));
    results.push({contextLoss:fallback});
  } finally {await lost.context.close();}
  const leaving=await setup();
  try {
    await leaving.target.locator('#box-button').click(); await wait(leaving.target,600);
    const cleanup=await leaving.target.evaluate(()=>{
      dispatchEvent(new Event('pagehide'));
      return {canvas:document.querySelectorAll('#scene canvas').length,
        animations:document.querySelector('.choice-motion').getAnimations().length,
        prompt:document.querySelector('#journey-choices').hasAttribute('data-prompt')};
    });
    assert(cleanup.canvas===0 && cleanup.animations===0 && !cleanup.prompt,'离页遗留场景或提示引用');
    assert(leaving.errors.length===0,JSON.stringify(leaving.errors));
    results.push({pagehide:cleanup});
  } finally {await leaving.context.close();}
  return results;
}
