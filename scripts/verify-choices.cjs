// 提示、输入与目标锁定均使用真实浏览器事件；目的地在网络边界拦截，不访问外站。
async (page) => {
  const browser=page.context().browser(), origin=new URL(page.url()).origin, results=[];
  const assert=(value,message)=>{if(!value) throw new Error(message);};
  async function setup(name, options={}) {
    const context=await browser.newContext({viewport:{width:1366,height:768}, ...options});
    const target=await context.newPage(), errors=[], navigation=[];
    let presentation;
    await target.exposeFunction('recordChoiceNavigation',value=>{presentation=value;});
    target.on('pageerror',error=>errors.push(error.message));
    for(const destination of ['https://example.com/blog','https://example.org/']) await target.route(destination, async route=>{
      navigation.push({destination,...presentation});
      await route.fulfill({contentType:'text/html',body:`<h1>${name} reached</h1>`});
    });
    if(options.fallback) await target.addInitScript(()=>{
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:get.call(this,type,...args);};
    });
    await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]:not([inert])');
    await target.evaluate(()=>{
      window.__choiceStarts=0;
      new MutationObserver(records=>{
        for(const r of records) if(r.attributeName==='data-prompt' && document.querySelector('#journey-choices').dataset.prompt==='true') window.__choiceStarts++;
        if(document.querySelector('#ink-transition').dataset.black==='true') window.__choiceBlackAt??=performance.now();
        if(document.querySelector('#app').dataset.state==='redirect') window.recordChoiceNavigation({
          black:document.querySelector('#ink-transition').dataset.black, complete:document.querySelector('#inscription').dataset.complete,
          now:performance.now(), blackAt:window.__choiceBlackAt,state:'redirect'});
      }).observe(document.querySelector('#app'),{attributes:true,subtree:true});
    });
    return {context,target,errors,navigation};
  }
  const prompt=await setup('prompt');
  try {
    const {target}=prompt;
    await target.locator('#box-button').click();
    const captured=await target.evaluate(()=>new Promise(resolve=>{
      const samples=[],start=performance.now();
      const sample=()=>{
        const host=document.querySelector('#scene'),app=document.querySelector('#app'), group=document.querySelector('.choice-motion');
        const icons=[...document.querySelectorAll('.phoenix-crown,.monkey-face')].map(el=>el.getBoundingClientRect());
        samples.push({elapsed:performance.now()-start,yaw:+host.dataset.choiceYaw,lid:+host.dataset.lidAngle,
          beams:host.dataset.beamsVisible,spread:+(document.querySelector('#whiteout').dataset.spread||0),state:app.dataset.state,
          axis:Math.abs(icons[0].x+icons[0].width/2-icons[1].x-icons[1].width/2),x:new DOMMatrix(getComputedStyle(group).transform).m41});
        if(performance.now()-start<820) requestAnimationFrame(sample); else resolve(samples);
      };
      // 原生指针释放后伴随的 click 不得导致二次提示；播放中的按钮激活也不得重开或排队。
      document.querySelector('#box-button').click(); sample();
    }));
    assert(captured.every(s=>s.state==='idle' && s.lid===0 && s.beams==='false' && s.spread===0 && s.axis<=1 && Math.abs(s.x)<=6.01 && Math.abs(s.yaw)<=1.2*Math.PI/180),'提示改变盒盖、灯光、旅程或图标轴线');
    assert(captured.some(s=>Math.abs(s.yaw)>.002),'宝盒未轻颤');
    assert(captured.some(s=>Math.abs(s.x)>4),'两个选项未明显抖动');
    assert(captured.at(-1).yaw===0 && captured.at(-1).x===0,'提示未精确归位');
    assert(await target.evaluate(()=>window.__choiceStarts===1 && document.activeElement!==document.querySelector('[data-entrance=blog]')),'提示重复触发或鼠标强移焦点');
    // 后台冻结盒体与文字的同一提示；切换偏好保留播放位置，不重新开始。
    await target.locator('#box-button').click();
    const paused=await target.evaluate(()=>{
      const a=document.querySelector('.choice-motion').getAnimations()[0];
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
      return {time:a.currentTime,frames:document.querySelector('#scene').dataset.frames};
    });
    await target.waitForTimeout(300);
    assert(await target.evaluate(before=>{const a=document.querySelector('.choice-motion').getAnimations()[0];return a.playState==='paused'&&Math.abs(a.currentTime-before.time)<1&&document.querySelector('#scene').dataset.frames===before.frames;},paused),'后台提示继续播放');
    await target.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await target.setViewportSize({width:1365,height:768});
    assert(await target.evaluate(()=>window.__choiceStarts===2),'尺寸变化重新播放提示');
    await target.emulateMedia({reducedMotion:'reduce'});
    assert(await target.evaluate(()=>{
      const group=document.querySelector('.choice-motion');return new DOMMatrix(getComputedStyle(group).transform).m41===0 &&
        [...document.querySelectorAll('[data-entrance]')].every(el=>getComputedStyle(el).outlineStyle==='solid');
    }),'减少动态没有同时强调两个选项');
    await target.waitForSelector('#journey-choices:not([data-prompt])');
    await target.locator('#box-button').focus();await target.keyboard.press('Space');
    assert(await target.locator('[data-entrance=blog]').evaluate(el=>document.activeElement===el),'键盘宝盒没有聚焦第一项');
    await target.keyboard.press('Tab');await target.keyboard.press('Enter');
    assert(await target.evaluate(()=>{
      // 同步尝试改写目标、重复提示及带修饰键激活，必须被已接受的目标门禁拦截。
      document.querySelector('[data-entrance=blog]').click();document.querySelector('#box-button').click();
      document.querySelector('[data-entrance=blog]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
      return document.querySelector('#app').dataset.state==='transition' && !document.querySelector('#journey-choices').hasAttribute('data-prompt') &&
        getComputedStyle(document.querySelector('.choice-motion')).transform==='none' && document.querySelector('#box-button').disabled &&
        [...document.querySelectorAll('[data-entrance]')].every(el=>el.getAttribute('aria-disabled')==='true'&&el.tabIndex===-1);
    }),'接受选择后未清理提示或未禁用入口');
    await target.waitForURL('https://example.org/');
    const nav=prompt.navigation[0];
    assert(prompt.navigation.length===1&&nav.black==='true'&&nav.complete==='true'&&nav.now-nav.blackAt>=159,'世界入口绕过实际全黑门禁或导航多次');
    assert(prompt.errors.length===0,JSON.stringify(prompt.errors));
    results.push({scenario:'prompt, pause, reduced, keyboard and world lock',samples:captured.length,maxYawDegrees:Math.max(...captured.map(s=>Math.abs(s.yaw)))*180/Math.PI,maxTranslation:Math.max(...captured.map(s=>Math.abs(s.x))),navigation:nav});
  } finally {await prompt.context.close();}
  // 触屏滑动和长按不提示，正常轻触一次；提示中直接命中文字入口后锁定博客目标。
  const touch=await setup('touch',{viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  try {
    const {target}=touch, box=await target.locator('#box-button').boundingBox(), x=box.x+box.width/2,y=box.y+box.height/2;
    const cdp=await target.context().newCDPSession(target);
    for(const action of ['swipe','long']) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      if(action==='swipe') await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+50,y}]});
      else await target.waitForTimeout(750);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert(await target.evaluate(()=>window.__choiceStarts===0&&document.querySelector('#app').dataset.state==='idle'),`${action} 误激活提示`);
    }
    await target.touchscreen.tap(x,y);
    assert(await target.evaluate(()=>window.__choiceStarts===1&&document.querySelector('#journey-choices').dataset.prompt==='true'),'轻触未触发一次提示');
    const r=await target.locator('[data-entrance=blog]').boundingBox();await target.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
    await target.locator('[data-entrance=world]').dispatchEvent('click');
    await target.waitForURL('https://example.com/blog');
    assert(touch.navigation.length===1&&touch.navigation[0].black==='true'&&touch.navigation[0].now-touch.navigation[0].blackAt>=159,'博客入口锁定或全黑门禁失效');
    assert(touch.errors.length===0,JSON.stringify(touch.errors));
    results.push({scenario:'touch swipe, long press, tap and blog lock',navigation:touch.navigation[0]});
  } finally {await touch.context.close();}
  // 正常动态中立即选择：取消颤动与抖动必须先精确归位，再启动首帧开盒。
  const interrupt=await setup('interrupt');
  try {
    const {target}=interrupt;
    await target.locator('#box-button').click();
    const accepted=await target.evaluate(()=>new Promise(resolve=>{
      const sample=()=>{
        const group=document.querySelector('.choice-motion'),x=new DOMMatrix(getComputedStyle(group).transform).m41;
        if(Math.abs(x)<2) {requestAnimationFrame(sample);return;}
        document.querySelector('[data-entrance=world]').click();
        resolve({before:x,transform:getComputedStyle(group).transform,yaw:+document.querySelector('#scene').dataset.choiceYaw,
          lid:+document.querySelector('#scene').dataset.lidAngle,state:document.querySelector('#app').dataset.state});
      };requestAnimationFrame(sample);
    }));
    assert(accepted.transform==='none'&&accepted.yaw===0&&accepted.lid===0&&accepted.state==='transition',`选择未先归位：${JSON.stringify(accepted)}`);
    await target.emulateMedia({reducedMotion:'reduce'});
    await target.waitForURL('https://example.org/');
    assert(interrupt.navigation.length===1&&interrupt.errors.length===0,'取消提示后导航异常');
    results.push({scenario:'normal-motion selection cancels at once',accepted});
  } finally {await interrupt.context.close();}
  // 降级时只移动选项，风景背景不参与动画；猴眼仅由此入口的悬停或聚焦点亮。
  const fallback=await setup('fallback',{fallback:true});
  try {
    const {target}=fallback;
    const eye=await target.locator('.monkey-eye').evaluate(el=>getComputedStyle(el).fill);
    await target.locator('#box-button').click();
    assert(await target.locator('.monkey-eye').evaluate((el,color)=>getComputedStyle(el).fill===color,eye),'提示自动点亮猴眼');
    assert(await target.locator('.scene-fallback').evaluate(el=>el.getAnimations().length===0&&getComputedStyle(el).transform==='none'),'降级提示移动了整张风景');
    await target.waitForSelector('#journey-choices:not([data-prompt])');
    await target.keyboard.press('Tab');
    await target.locator('[data-entrance=world]').focus();await target.waitForTimeout(350);
    assert(await target.locator('.monkey-eye').evaluate((el,color)=>getComputedStyle(el).fill!==color,eye),'聚焦未点亮猴眼');
    assert(await target.locator('.journey-copy').evaluate(el=>getComputedStyle(el).animationName==='world-curiosity'),'文字未使用独立悬停层');
    assert(await target.locator('.monkey-face').evaluate(el=>getComputedStyle(el).animationName==='none'&&getComputedStyle(el).transform==='none'),'猴头参与了文字位移');
    results.push({scenario:'fallback and eye focus',passed:true});
  } finally {await fallback.context.close();}
  return results;
}
