// 真实浏览器覆盖双入口的静止、抖动与降级布局，截图作为最终可查看的验收产物。
async (page) => {
  const origin = new URL(page.url()).origin, browser = page.context().browser(), results = [];
  // 桌面短视口覆盖紧凑排版与标题字号的临界高度，避免入口被固定视口裁切。
  const sizes = [[1920,1080],[1920,600],[1920,601],[1920,700],[1920,701],[1920,720],[1920,721],[1920,768],[1920,800],[1920,840],[1920,841],[1366,768],[390,844],[3440,1440],[320,480],[320,500],[640,500],[640,600],[1100,1000]];
  // 横跨手机、平板和桌面的宽度断点，检查高度恢复常规排版时的真实命中。
  for (const width of [767, 768, 800, 900, 1023, 1024])
    for (const height of [700, 701, 720, 721, 768, 800, 840, 841]) sizes.push([width, height]);
  // 静态背景的纵横比与短屏排版交界也要覆盖，包含常见手机与较宽手机的两侧。
  sizes.push([320,721],[390,721],[430,721],[480,601],[480,721],[500,601],[500,721],
    [600,601],[600,721],[640,601],[640,721],[700,601],[767,601],
    [430,601],[431,601],[432,721],[433,721],[500,833],[500,834]);
  for (const mode of ["normal", "fallback", "no-script", "module-failure", "forced-colors"]) {
    const context = await browser.newContext({ javaScriptEnabled: mode !== "no-script", reducedMotion: "reduce",
      forcedColors: mode === "forced-colors" ? "active" : "none" });
    try {
      const target = await context.newPage();
      if (mode === "fallback") await target.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/i.test(type) ? null : get.call(this, type, ...args); };
      });
      if (mode === "module-failure") await target.route(/\/assets\/index-[^/]+\.js(?:\?|$)/, route => route.abort());
      await target.goto(origin);
      if (mode !== "no-script") await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      for (const [width,height] of sizes) {
        await target.setViewportSize({width,height});
        await target.waitForTimeout(100);
        const inspect = () => target.evaluate(() => {
          const rect = el => { const r=el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
          const links=[...document.querySelectorAll('[data-entrance]')];
          const boxElement=document.querySelector(getComputedStyle(document.querySelector('#box-button')).display === 'none' ? '#static-box' : '#box-button');
          const box=rect(boxElement);
          // 宝盒边缘也必须命中自身；只测入口中心会漏掉新增入口覆盖盒面上缘的情况。
          const blockedBoxPoints=[];
          for (const x of [.1, .3, .5, .7, .9]) for (const y of [.1, .3, .5, .7, .9]) {
            const px=box.x+box.width*x, py=box.y+box.height*y;
            if (!boxElement.contains(document.elementFromPoint(px,py))) blockedBoxPoints.push({x:px,y:py});
          }
          const overlaps=(a,b) => a.x<b.right && a.right>b.x && a.y<b.bottom && a.bottom>b.y;
          const entries=links.map(link=>{
            const bounds=rect(link), icon=rect(link.firstElementChild), copy=rect(link.lastElementChild);
            const glyphs=[...link.querySelectorAll('.calligraphy-copy,.calligraphy-text,small')]
              .filter(el=>getComputedStyle(el).display!=='none' && !el.classList.contains('sr-only') || (el.classList.contains('calligraphy-text') && getComputedStyle(el).position==='static'))
              .map(rect);
            return {bounds,icon,copy,glyphs,overlap:overlaps(bounds,box),height:bounds.height,
              clipped:glyphs.some(r=>r.x<6 || r.right>innerWidth-6 || r.y<0 || r.bottom>innerHeight),
              hit:link.contains(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2))};
          });
          return { entries, box, blockedBoxPoints, axisError:Math.abs(entries[0].icon.x+entries[0].icon.width/2-entries[1].icon.x-entries[1].icon.width/2),
            textError:Math.abs(entries[0].copy.x-entries[1].copy.x), overflow:document.documentElement.scrollWidth>innerWidth };
        });
        const layout=await inspect();
        if(layout.overflow || layout.blockedBoxPoints.length || layout.axisError>1 || layout.textError>1 || layout.entries.some(e=>e.overlap||e.clipped||!e.hit||e.height<44))
          throw new Error(`${mode} ${width}x${height}: ${JSON.stringify(layout)}`);
        await target.screenshot({path:`output/playwright/choices-${mode}-${width}x${height}.png`});
        // 动画在同一外层暂停到峰值，精确检查图标同轴及边缘余量，不用截图延迟代替采样。
        if (mode === "normal") {
          await target.emulateMedia({reducedMotion:"no-preference"});
          await target.locator('#box-button').click();
          // 两个方向的最大位移都不能侵入宝盒点击区或被屏幕边缘裁切。
          for (const time of [160, 320]) {
            await target.evaluate(time=>{const a=document.querySelector('.choice-motion').getAnimations()[0];a.pause();a.currentTime=time;}, time);
            const shaking=await inspect();
            if(shaking.blockedBoxPoints.length || shaking.axisError>1 || shaking.entries.some(e=>e.clipped||!e.hit||e.overlap)) throw new Error(`抖动布局 ${width}x${height} at ${time}ms: ${JSON.stringify(shaking)}`);
            await target.screenshot({path:`output/playwright/choices-shaking-${time}-${width}x${height}.png`});
          }
          await target.evaluate(()=>{const a=document.querySelector('.choice-motion').getAnimations()[0];a.finish();});
          await target.waitForSelector('#journey-choices:not([data-prompt])');
          await target.emulateMedia({reducedMotion:"reduce"});
        }
        results.push({mode,width,height,axisError:layout.axisError,textError:layout.textError,heights:layout.entries.map(e=>e.height)});
      }
    } finally { await context.close(); }
  }
  return results;
}
