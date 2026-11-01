// 与 CLI video-start / video-stop 配合，记录实际前台时间的完整转场；同时留下四阶段静帧与时间读数。
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
  const origin = new URL(page.url()).origin;
  // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.clock.resume();
  await page.setViewportSize({width:1366,height:768});
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.route(destinations.blog,route=>route.fulfill({contentType:"text/html",body:"<h1>已完成题词，进入博客</h1>"}));
  await page.goto(origin);
  await page.waitForSelector('#app[data-state="idle"]:not([inert])');
  await page.evaluate(() => {
    const samples = window.__inkRecording = [], start = performance.now();
    const observer = new MutationObserver(() => {
      const veil = document.querySelector("#whiteout"), ink = document.querySelector("#inscription");
      samples.push({at:performance.now()-start,white:veil.dataset.white,visible:ink.dataset.visible,progress:+ink.dataset.progress,complete:ink.dataset.complete});
    });
    observer.observe(document.querySelector("#inscription"),{attributes:true});
  });
  await page.locator("[data-entrance=blog]").focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(()=>+document.querySelector("#inscription").dataset.progress>.012);
  await page.mouse.move(-100,-100);
  await page.screenshot({path:"output/playwright/inscription-live-start.png"});
  await page.waitForFunction(()=>+document.querySelector("#inscription").dataset.progress>.49);
  await page.screenshot({path:"output/playwright/inscription-live-half.png"});
  await page.waitForFunction(()=>document.querySelector("#inscription").dataset.complete==="true");
  await page.screenshot({path:"output/playwright/inscription-live-full.png"});
  await page.waitForTimeout(850);
  await page.screenshot({path:"output/playwright/inscription-live-before-navigation.png"});
  const samples = await page.evaluate(()=>window.__inkRecording);
  const white = samples.find(sample=>sample.white==="true"), visible = samples.find(sample=>sample.visible==="true"), full = samples.find(sample=>sample.complete==="true");
  await page.waitForURL(destinations.blog);
  return {whiteAt:white.at,startAt:visible.at,fullAt:full.at,waitMs:visible.at-white.at,writeMs:full.at-visible.at,samples:samples.length};
}
