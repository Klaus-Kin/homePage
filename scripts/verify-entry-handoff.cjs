// 在真实页面延迟图标模块，比较接管前后的完整图标画幅，而非仅检查元素尺寸或资源已下载。
async (page) => {
  const origin=new URL(page.url()).origin,browser=page.context().browser(),results=[];
  const assert=(value,message)=>{if(!value) throw new Error(message);};
  for(const [width,height,size] of [[1366,768,44],[390,844,36],[640,500,30]]) for(const ratio of [1,2]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:ratio});
    const target=await context.newPage(),errors=[];
    let release;
    target.on('pageerror',error=>errors.push(error.message));
    try {
      await target.route(/\/src\/entry-icons\.ts(?:\?|$)/,async route=>{
        await new Promise(resolve=>{release=resolve;});await route.continue();
      });
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      await target.mouse.move(width-2,2);
      await target.locator('.entry-fallback img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
      // 在两种图层背后加相同的纯色，排除云、草和远山动画对逐像素比较的干扰。
      await target.addStyleTag({content:'.entry-icon::before{content:"";position:absolute;inset:-30%;background:#151923}.entry-fallback,.entry-canvas{z-index:1}'});
      const before=[];
      for(const kind of ['blog','world']) {
        const fallback=target.locator(`[data-entrance=${kind}] .entry-fallback`);
        const image=target.locator(`[data-entrance=${kind}] .entry-fallback img`).first();
        const source=await image.evaluate(el=>el.currentSrc);
        const name=kind==='blog'?'crown':'monkey';
        assert(source.endsWith(`entry-${name}-${size}${ratio===2?'@2x':''}.png`),`响应式后备选择错误：${source}`);
        before.push(await fallback.screenshot({path:`output/playwright/handoff-${name}-${size}-${ratio}x-before.png`}));
      }
      for(let i=0;i<30&&!release;i++) await target.waitForTimeout(50);
      assert(!!release,'没有捕获真实图标模块请求');release();
      await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready=true]').length===2);
      for(let i=0;i<2;i++) {
        const kind=i===0?'blog':'world',name=i===0?'crown':'monkey';
        const after=await target.locator(`[data-entrance=${kind}] .entry-canvas`).screenshot({path:`output/playwright/handoff-${name}-${size}-${ratio}x-after.png`});
        const metrics=await target.evaluate(async({before,after})=>{
          async function decode(data) {
            const image=new Image();image.src=`data:image/png;base64,${data}`;await image.decode();
            const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
            const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
            return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
          }
          const a=await decode(before),b=await decode(after);
          if(a.width!==b.width||a.height!==b.height) throw new Error('接管前后画幅尺寸不同');
          let total=0,changed=0,max=0;
          for(let at=0;at<a.data.length;at+=4) {
            let delta=0;
            for(let channel=0;channel<3;channel++) {
              const diff=Math.abs(a.data[at+channel]-b.data[at+channel]);total+=diff;delta=Math.max(delta,diff);
            }
            if(delta>8) changed++;max=Math.max(max,delta);
          }
          return {width:a.width,height:a.height,mean:total/(a.width*a.height*3),changed:changed/(a.width*a.height),max};
        },{before:before[i].toString('base64'),after:after.toString('base64')});
        assert(metrics.mean<.3&&metrics.changed<.005,`图标接管存在明显变化：${JSON.stringify({name,size,ratio,metrics})}`);
        results.push({name,size,ratio,...metrics});
      }
      assert(errors.length===0,JSON.stringify(errors));
    } finally {release?.();await context.close();}
  }
  // 模块尚未到达时先用键盘点亮红眼，接管的第一帧必须延续已显示的反馈，不能先恢复成金眼。
  const context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:2});
  let release;
  try {
    const target=await context.newPage();
    await target.route(/\/src\/entry-icons\.ts(?:\?|$)/,async route=>{
      await new Promise(resolve=>{release=resolve;});await route.continue();
    });
    await target.goto(origin);
    await target.waitForSelector('#app[data-state="idle"]:not([inert])');
    await target.keyboard.press('Tab');await target.locator('[data-entrance=world]').focus();
    await target.waitForTimeout(450);
    const expected=await target.locator('.monkey-eye img').evaluate(async source=>{
      // 用独立图片读取文件的真实像素尺寸，避免 srcset 的密度修正把后备计数缩小四倍。
      const image=new Image();image.src=source.currentSrc;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      return Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data).filter((red,i,data)=>i%4===0&&red>100&&red>data[i+1]*1.8&&red>data[i+2]*1.8).length;
    });
    assert(expected>0,'红眼后备没有可见的红色像素');
    await target.locator('[data-entrance=world] .entry-icon').evaluate(slot=>{
      // 在同一帧的微任务内读取绘制结果，避免透明画布的默认缓冲在下一帧被清空。
      new MutationObserver(()=>{
        if(slot.dataset.modelReady==='true'&&!window.__firstEntryFrame) window.__firstEntryFrame=slot.querySelector('canvas').toDataURL();
      }).observe(slot,{attributes:true,attributeFilter:['data-model-ready']});
    });
    for(let i=0;i<30&&!release;i++) await target.waitForTimeout(50);
    assert(!!release,'没有捕获聚焦情形下的图标请求');release();
    await target.waitForFunction(()=>window.__firstEntryFrame);
    const actual=await target.evaluate(async()=>{
      const image=new Image();image.src=window.__firstEntryFrame;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      return Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data).filter((red,i,data)=>i%4===0&&red>100&&red>data[i+1]*1.8&&red>data[i+2]*1.8).length;
    });
    assert(actual>=expected*.9&&actual<=expected*1.1,`聚焦后接管首帧红眼不一致：${JSON.stringify({expected,actual})}`);
    results.push({scenario:'focused first frame',expectedRedPixels:expected,actualRedPixels:actual});
  } finally {release?.();await context.close();}
  return results;
}
