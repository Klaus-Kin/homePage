// 生产页面的题词验收：独立笔画、精确背景像素、可见时间门禁、响应式重排和所有脚本可用的降级入口。
async (page) => {
  // 从当前服务的静态入口读取实际地址；独立无脚本文档不会启动额外的 WebGL 场景。
  const linkContext = await page.context().browser().newContext({ javaScriptEnabled: false });
  let destinations;
  try {
    const links = await linkContext.newPage();
    await links.goto(new URL(page.url()).origin);
    destinations = await links.locator("[data-entrance]").evaluateAll(links =>
      Object.fromEntries(links.map(link => [link.dataset.entrance, link.href])));
  } finally { await linkContext.close(); }
  const origin = new URL(page.url()).origin, browser = page.context().browser(), results = [];
  const phrase = "一念间,又是另一个世界";
  async function inspect(target) {
    return target.evaluate(() => {
      const ink = document.querySelector("#inscription"), veil = document.querySelector("#whiteout");
      const glyphs = [...ink.querySelectorAll("svg")];
      return { visible: ink.dataset.visible, complete: ink.dataset.complete, mode: ink.dataset.mode,
        progress: +ink.dataset.progress, white: veil.dataset.white, state: document.querySelector("#app").dataset.state,
        text: glyphs.map(glyph => glyph.dataset.character).join(""),
        pens: [...ink.querySelectorAll("[data-pen]")].map(pen => +pen.dataset.progress),
        rects: glyphs.map(glyph => glyph.getBoundingClientRect().toJSON()),
        lines: [...ink.querySelectorAll(".inscription-line")].map(line => line.getBoundingClientRect().toJSON()),
        width: innerWidth, height: innerHeight, status: document.querySelector("#status").textContent,
        opacity: +ink.querySelector("[data-complete]").getAttribute("opacity") };
    });
  }
  async function capture(target, name) {
    // 像素验收时将真实指针移出视口，让既有自定义光标按正常 pointerleave 收起；不修改背景或放宽掩码。
    await target.mouse.move(-100,-100);
    const shot = await target.screenshot({ path: `output/playwright/inscription-${name}.png` });
    const pixels = await target.evaluate(async uri => {
      const image = new Image(); image.src = uri; await image.decode();
      const actual = document.createElement("canvas"), expected = document.createElement("canvas");
      actual.width = expected.width = image.width; actual.height = expected.height = image.height;
      const ctx = actual.getContext("2d"), mask = expected.getContext("2d"); ctx.drawImage(image,0,0);
      const scale = image.width / innerWidth;
      // 使用完整墨面逐字生成独立的文字像素掩码；只豁免真实字形及一像素抗锯齿边缘，不豁免文字矩形。
      for (const glyph of document.querySelectorAll("#inscription svg")) {
        const rect = glyph.getBoundingClientRect(), path = glyph.querySelector("defs > path");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${glyph.getAttribute("viewBox")}"><path d="${path.getAttribute("d")}" fill="black" stroke="black" stroke-width="${2 / (rect.width / glyph.viewBox.baseVal.width * scale)}" fill-rule="evenodd"/></svg>`;
        const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await img.decode();
        mask.drawImage(img,rect.x*scale,rect.y*scale,rect.width*scale,rect.height*scale);
      }
      const rgba = ctx.getImageData(0,0,image.width,image.height).data;
      const allowed = mask.getImageData(0,0,image.width,image.height).data;
      let outsideInk = 0, mismatch = 0, inkPixels = 0;
      for (let i=0;i<rgba.length;i+=4) {
        const yellow = rgba[i]===255 && rgba[i+1]===241 && rgba[i+2]===199 && rgba[i+3]===255;
        if (!allowed[i+3]) { outsideInk++; if (!yellow) mismatch++; }
        if (rgba[i] < 100 && rgba[i+1] < 100 && rgba[i+2] < 100) inkPixels++;
      }
      return { outsideInk, mismatch, inkPixels };
    }, `data:image/png;base64,${shot.toString("base64")}`);
    if (pixels.mismatch || pixels.outsideInk < 1000) throw new Error(`${name}: 文字外的光幕未保持原淡黄完全不透明 ${JSON.stringify(pixels)}`);
    return pixels;
  }
  async function setup(options = {}, noWebgl = false) {
    const context = await browser.newContext({ viewport: { width:1366,height:768 }, ...options });
    const target = await context.newPage(), errors = [], announcements = [];
    // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
    await context.route("**/*", route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    let navigations = 0;
    target.on("pageerror", error => errors.push(error.message));
    await target.exposeFunction("recordInkAnnouncement", text => announcements.push(text));
    if (noWebgl) await target.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type,...args) { return /webgl/i.test(type) ? null : get.call(this,type,...args); };
    });
    await target.route(destinations.blog, async route => {
      navigations++;
      await route.fulfill({contentType:"text/html",body:"<h1>题词后的目的地</h1>"});
    });
    await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]');
    // 初始化会等待真实 RAF 与异步纹理，先就绪再冻结时钟，避免把启动过程卡在虚拟时间零点。
    await target.clock.install(); await target.clock.pauseAt(new Date(Date.now()+100));
    await target.evaluate(() => new MutationObserver(() => window.recordInkAnnouncement(document.querySelector("#status").textContent))
      .observe(document.querySelector("#status"),{childList:true,characterData:true,subtree:true}));
    return { context,target,errors,announcements,navigations:()=>navigations };
  }
  // 四个截图阶段与逐帧推进验收；桌面一行、手机两行，边距和居中从真实字框计算。
  for (const [name,width,height] of [["desktop",1366,768],["phone",390,844],["small",320,480],["landscape",640,600],["square",1100,1000],["breakpoint",768,1024]]) {
    const check = await setup({viewport:{width,height}}), {context,target} = check;
    try {
      await target.locator("[data-entrance=blog]").focus(); await target.keyboard.press("Enter");
      await target.keyboard.press("Enter");
      await target.clock.runFor(2848);
      const covered = await inspect(target);
      if (covered.visible === "true" || check.navigations()) throw new Error("120ms 等待前出现题词或跳转");
      await capture(target,`${name}-covered`);
      await target.clock.runFor(160);
      const start = await inspect(target), startPixels = await capture(target,`${name}-start`);
      if (start.visible !== "true" || start.progress <= 0 || start.progress >= .08 || start.pens.slice(1).some(p=>p>0)) throw new Error(`起笔不独立 ${JSON.stringify(start)}`);
      await target.clock.runFor(1440);
      const half = await inspect(target), halfPixels = await capture(target,`${name}-half`);
      if (half.progress < .45 || half.progress > .55 || half.pens.filter(p=>p===1).length < 10 || half.pens.every(p=>p>0) || halfPixels.inkPixels <= startPixels.inkPixels) throw new Error("半句没有逐笔保留墨迹");
      // 改变宽高仅布局，不重置写字进度；与原视口恢复后继续原时间轴。
      await target.setViewportSize({width:height,height:width}); await target.setViewportSize({width,height});
      if ((await inspect(target)).progress !== half.progress) throw new Error("旋转重播了书写");
      await target.clock.runFor(1504);
      const full = await inspect(target);
      // 完成同帧已有落滴，淡黄像素验收保留在起笔与半句阶段；完整题词截图包含真实墨滴。
      await target.screenshot({path:`output/playwright/inscription-${name}-full.png`});
      if (full.complete !== "true" || full.progress !== 1 || full.opacity !== 1 || check.navigations() || full.text !== phrase || full.status !== phrase) throw new Error("完整题词或停留门禁异常");
      const [first,second] = full.lines;
      if ((width<768 && second.top <= first.bottom) || (width>=768 && Math.abs(first.top-second.top)>.5)) throw new Error("断行位置错误");
      for (const rect of full.rects) if (rect.left<24 || rect.right>width-24 || rect.top<24 || rect.bottom>height-24) throw new Error("文字不足24px安全边距");
      const groupLeft = Math.min(first.left,second.left), groupRight = Math.max(first.right,second.right);
      if (Math.abs((groupLeft+groupRight)/2-width/2)>.6 || Math.abs((first.top+second.bottom)/2-height/2)>.6) throw new Error("题词组没有居中");
      await target.clock.runFor(1008); await target.screenshot({path:`output/playwright/inscription-${name}-before-navigation.png`});
      if (check.navigations()) throw new Error("落墨扩散尚未完成却提前导航");
      await target.clock.runFor(1600); await target.waitForURL(destinations.blog);
      if (check.navigations()!==1 || check.errors.length || check.announcements.filter(text=>text===phrase).length!==1) throw new Error(JSON.stringify({errors:check.errors,announcements:check.announcements}));
      results.push({name,stages:{start:start.progress,half:half.progress,full:full.progress},pixels:halfPixels,announcedOnce:true});
    } finally { await context.close(); }
  }
  // 分别在书写和淡黑期间模拟后台，检测墨迹不变且恢复后不会补跳；中途偏好切换保留已写部分。
  for (const kind of ["hidden-writing","hidden-reading","reduce-mid-writing","reduced-fade","complete-preference","fallback-button","fallback-text"]) {
    const reduced = kind === "reduced-fade" || kind === "hidden-reading" || kind.startsWith("fallback");
    const check = await setup({reducedMotion:reduced?"reduce":"no-preference"},kind.startsWith("fallback")),{context,target}=check;
    try {
      const trigger = kind === "fallback-text" ? "[data-entrance=blog]" : "[data-entrance=blog]";
      await target.locator(trigger).focus(); await target.keyboard.press("Enter");
      await target.clock.runFor(reduced?800:4400);
      let snapshot = await inspect(target);
      if (kind.startsWith("hidden")) {
        if (kind === "hidden-reading") { await target.clock.runFor(208); snapshot = await inspect(target); }
        await target.evaluate(() => { Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange")); });
        await target.clock.runFor(20000);
        const hidden = await inspect(target);
        if (hidden.progress!==snapshot.progress || hidden.opacity!==snapshot.opacity || check.navigations()) throw new Error(`${kind}: 后台时间推进`);
        await target.evaluate(() => { delete document.hidden;document.dispatchEvent(new Event("visibilitychange")); });
        await target.clock.runFor(32);
        if (check.navigations()) throw new Error("恢复首帧提前跳转");
      }
      if (kind === "reduce-mid-writing") {
        await target.emulateMedia({reducedMotion:"reduce"}); await target.clock.runFor(32);
        const fade = await inspect(target);
        if (fade.mode!=="fade" || fade.complete==="true" || fade.progress!==snapshot.progress) throw new Error("开启减少动态时没有保留墨迹并淡入");
        await target.emulateMedia({reducedMotion:"no-preference"}); await target.clock.runFor(192);
        if ((await inspect(target)).complete!=="true" || check.navigations()) throw new Error("偏好切换重播或提前跳转");
      }
      if (kind === "complete-preference") {
        await target.clock.runFor(1680); await target.emulateMedia({reducedMotion:"reduce"}); await target.clock.runFor(32);
        if ((await inspect(target)).complete!=="true") throw new Error("完整题词切换偏好后重播");
      }
      if (kind === "reduced-fade") {
        if (snapshot.mode!=="fade" || snapshot.opacity<=0 || snapshot.opacity>=1) throw new Error("减少动态没有180ms整句淡入");
        await target.clock.runFor(208); await target.screenshot({path:"output/playwright/inscription-reduced-full.png"});
      }
      // 剩余时间足够完成流程，重复激活不能产生第二次导航或第二次整句播报。
      await target.clock.runFor(8000); await target.waitForURL(destinations.blog);
      if (check.navigations()!==1 || check.errors.length || check.announcements.filter(text=>text===phrase).length!==1) throw new Error(`${kind}: ${JSON.stringify(check.errors)}`);
      results.push({kind,navigations:check.navigations(),announcedOnce:true});
    } finally { await context.close(); }
  }
  return results;
}
