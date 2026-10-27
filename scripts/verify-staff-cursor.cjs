// 原生光标不包含在网页截图中，因此单独展示同一 SVG，并检查桌面样式、棒头热点与触屏回退。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  await page.setViewportSize({width:1920,height:1080});
  await page.goto(origin);
  await page.waitForSelector('#app[data-state="idle"]');
  const desktop = await page.evaluate(() => {
    const selectors = ['html','#scene canvas','[data-entrance]','#box-button'];
    return selectors.map(selector => ({selector, cursor:getComputedStyle(document.querySelector(selector)).cursor}));
  });
  if(desktop.some(item=>!item.cursor.includes('golden-staff-cursor.svg') || !item.cursor.includes('3 3')))
    throw new Error(`桌面光标或棒头热点错误：${JSON.stringify(desktop)}`);
  results.push({desktop});
  await page.screenshot({path:'output/playwright/staff-desktop.png'});
  await page.setViewportSize({width:960,height:800});
  if(await page.locator('html').evaluate(el=>getComputedStyle(el).cursor.includes('golden-staff')))
    throw new Error('窄屏不应强制使用 PC 光标');
  const context = await page.context().browser().newContext({
    viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',
  });
  try {
    const mobile = await context.newPage();
    await mobile.goto(origin);await mobile.waitForSelector('#app[data-state="idle"]');
    if(await mobile.locator('html').evaluate(el=>getComputedStyle(el).cursor.includes('golden-staff')))
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
