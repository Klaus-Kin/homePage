// 检查金箍棒图层的实际裁切、原始方向、热点和触屏回退，并保留原 SVG 的材质与形状验收。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  await page.setViewportSize({width:1920,height:1080});
  await page.goto(origin);
  await page.waitForSelector('#app[data-state="idle"]');
  await page.mouse.move(600,400);
  await page.waitForSelector('.staff-cursor-layer:not([hidden])', {timeout:3000});
  const desktop = await page.evaluate(() => {
    const selectors = ['html','#scene canvas','[data-entrance]','#box-button'];
    return selectors.map(selector => ({selector, cursor:getComputedStyle(document.querySelector(selector)).cursor}));
  });
  if(desktop.some(item=>item.cursor!=='none'))
    throw new Error(`桌面金箍棒图层未替换系统光标：${JSON.stringify(desktop)}`);
  results.push({desktop});
  await page.screenshot({path:'output/playwright/staff-desktop.png'});
  // 用户要求边缘直接裁切；图片可以越界，承载它的透明固定层必须准确裁到视口。
  for(const [width,height] of [[1920,1080],[1366,768],[1024,768]]) {
    await page.setViewportSize({width,height});
    for(const [x,y] of [[0,0],[width-1,0],[0,height-1],[width-1,height-1],
      [width/2,height-1],[width-1,height/2],[width-69,height-69],[width-68,height-68]]) {
      await page.mouse.move(x,y);
      const edge = await page.evaluate(({x,y}) => {
        const layer=document.querySelector('.staff-cursor-layer'),image=layer.querySelector('img');
        const target=document.elementFromPoint(x,y),style=getComputedStyle(layer),imageStyle=getComputedStyle(image);
        const bounds=image.getBoundingClientRect(),clip=layer.getBoundingClientRect(),matrix=new DOMMatrixReadOnly(imageStyle.transform);
        return {x,y,cursor:getComputedStyle(target).cursor,asset:image.src,width:bounds.width,height:bounds.height,
          left:bounds.left,top:bounds.top,clip:clip.toJSON(),overflow:style.overflow,
          unflipped:matrix.a===1&&matrix.b===0&&matrix.c===0&&matrix.d===1,
          intercepts:target===layer||target===image,hidden:layer.hidden,scrollWidth:document.documentElement.scrollWidth};
      },{x,y});
      if(!edge.asset.endsWith('/golden-staff-cursor.svg') || edge.width!==72 || edge.height!==72 ||
        edge.left!==x-3 || edge.top!==y-3 || !edge.unflipped || edge.cursor!=='none' ||
        edge.clip.left!==0 || edge.clip.top!==0 || edge.clip.right!==width || edge.clip.bottom!==height ||
        edge.overflow!=='hidden' || edge.intercepts || edge.hidden || edge.scrollWidth!==width)
        throw new Error(`边缘金箍棒方向、裁切或命中行为错误：${JSON.stringify(edge)}`);
      results.push({edge});
    }
  }
  await page.mouse.move(512,767);
  await page.screenshot({path:'output/playwright/staff-edge-bottom.png'});
  // 离开网页后隐藏图层，避免鼠标已经移到浏览器工具栏而页面还留着金箍棒。
  await page.mouse.move(-1,-1);
  if(await page.locator('.staff-cursor-layer').evaluate(el=>!el.hidden))
    throw new Error('离开网页后遗留金箍棒图层');
  await page.mouse.move(500,300);
  // 触摸输入必须退出鼠标图层；没有成功显示图片时也必须保留可见的原生回退。
  const interaction = await page.evaluate(() => {
    const button=document.querySelector('#box-button');
    button.disabled=true;const disabledCursor=getComputedStyle(button).cursor;button.disabled=false;
    window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'touch',clientX:1023,clientY:767}));
    return {disabledCursor,touchHidesCursor:document.querySelector('.staff-cursor-layer').hidden};
  });
  if(interaction.disabledCursor!=='wait' || !interaction.touchHidesCursor)
    throw new Error(`等待或触屏行为发生回归：${JSON.stringify(interaction)}`);
  results.push({interaction});
  await page.setViewportSize({width:960,height:800});
  if(await page.locator('html').evaluate(el=>getComputedStyle(el).cursor.includes('golden-staff')))
    throw new Error('窄屏不应强制使用 PC 光标');
  if(await page.locator('html').evaluate(el=>el.classList.contains('staff-cursor-active')))
    throw new Error('进入窄屏后应撤销金箍棒图层');
  // 高像素密度屏幕同样保持原方向与 72 个 CSS 像素，窗口最下沿只裁切溢出部分。
  for(const deviceScaleFactor of [1.25,2]) {
    const context=await page.context().browser().newContext({viewport:{width:1280,height:800},deviceScaleFactor,reducedMotion:'reduce'});
    try {
      const target=await context.newPage();await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]');
      await target.mouse.move(640,799);
      await target.waitForSelector('.staff-cursor-layer:not([hidden])');
      const scaled=await target.locator('.staff-cursor-layer img').evaluate(image=>({
        top:image.getBoundingClientRect().top,width:image.getBoundingClientRect().width,
        source:image.getAttribute('src'),cursor:getComputedStyle(document.documentElement).cursor,
      }));
      if(scaled.top!==796 || scaled.width!==72 || scaled.source!=='/assets/golden-staff-cursor.svg' || scaled.cursor!=='none')
        throw new Error(`高像素密度边缘行为错误：${JSON.stringify(scaled)}`);
      results.push({deviceScaleFactor,scaled});
    } finally {await context.close();}
  }
  const context = await page.context().browser().newContext({
    viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',
  });
  try {
    const mobile = await context.newPage();
    await mobile.goto(origin);await mobile.waitForSelector('#app[data-state="idle"]');
    if(await mobile.locator('html').evaluate(el=>getComputedStyle(el).cursor.includes('golden-staff') || getComputedStyle(el).cursor==='none'))
      throw new Error('触屏不应启用 PC 光标');
    await mobile.screenshot({path:'output/playwright/staff-mobile.png'});
    results.push({touchUsesNativeCursor:true,narrowScreenUsesNativeCursor:true});
  } finally {await context.close();}

  const review = await page.context().newPage();
  try {
    await review.route('**/__staff-review',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`
      <html lang="zh-Hant"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:32px;background:#101c2d;color:#e8d3a4;font:16px/1.6 'Microsoft YaHei',sans-serif}
      h1{font-size:25px;font-weight:400;margin:0 0 22px}.cards{display:grid;grid-template-columns:230px 1fr;gap:24px}
      article{position:relative;height:410px;border:1px solid #d4b47e35;border-radius:14px;background:#091222;padding:22px}
      p{margin:0;color:#aeb9c9}.native{margin:80px auto 0;width:72px;height:72px}.native img{width:72px;height:72px}
      .large{width:288px;height:288px;margin:5px auto}.large img{width:288px;height:288px}
      </style><h1>金箍棒光標 · 雙端龍紋</h1><div class="cards">
      <article><p>實際尺寸 · 72 × 72</p><div class="native"><img src="/assets/golden-staff-cursor.svg" alt=""></div></article>
      <article><p>放大檢視 · ×4</p><div class="large"><img src="/assets/golden-staff-cursor.svg" alt=""></div></article>
      </div></html>`}));
    await review.setViewportSize({width:800,height:560});await review.goto(`${origin}/__staff-review`);
    const shape = await review.evaluate(async()=>{
      const image=new Image();image.src='/assets/golden-staff-cursor.svg';await image.decode();
      const size=image.naturalWidth,scale=size/88;
      if(size!==72 || image.naturalHeight!==72)throw new Error('光标未等比例缩小到 72 像素');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,size,size).data;
      // 沿棒身法线采样真实 alpha，验证透视粗细，忽略半透明投影。
      const widthAt = t => {
        let count=0;
        for(let across=-15;across<=15;across+=.5){
          const x=Math.round((4+(t-across)/Math.SQRT2)*scale),y=Math.round((4+(t+across)/Math.SQRT2)*scale);
          if(x>=0&&x<size&&y>=0&&y<size&&pixels[(y*size+x)*4+3]>200)count+=.5*scale;
        }
        return count;
      };
      const farWidth=widthAt(15),nearWidth=widthAt(86);
      if(nearWidth<farWidth*2 || farWidth<2)throw new Error(`棒身透视错误：${farWidth}/${nearWidth}`);
      // 棒头必须有实际厚度，热点必须落在不透明端面上，不能回退为针尖或偏到透明区域。
      const headWidth=widthAt(1.5),hotspotAlpha=pixels[(3*size+3)*4+3];
      if(headWidth<3 || hotspotAlpha<200)throw new Error(`棒头过尖或热点偏移：${headWidth}/${hotspotAlpha}`);
      const svg=await (await fetch(image.src)).text(),svgDocument=new DOMParser().parseFromString(svg,'image/svg+xml');
      if(svgDocument.querySelector('parsererror') || svgDocument.querySelectorAll('use[href="#dragon"]').length!==2)
        throw new Error('光标 SVG 无效或缺少双端龙纹');
      return {farWidth,nearWidth,headWidth,hotspotAlpha,hotspot:[3,3],image:[size,size],dragonEnds:2};
    });
    await review.screenshot({path:'output/playwright/golden-staff-cursor-review.png'});
    results.push({shape});return results;
  } finally {await review.close();}
}
