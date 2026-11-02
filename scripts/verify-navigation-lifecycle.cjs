// 通过 playwright-cli run-code --filename 执行。地址可带 ?view=desktop|phone|short 缩小录制矩阵。
// 真实跨站导航、慢响应、阻塞首屏和历史回退；所有网络延迟有固定终点，不在路由回调中等待页面操作。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  // 从当前服务的静态入口读取实际地址；独立无脚本文档不会启动额外的 WebGL 场景。
  const linkContext = await page.context().browser().newContext({ javaScriptEnabled: false });
  let destinations;
  try {
    const links = await linkContext.newPage().then(async target => { await linkContext.addInitScript(() => { window.__moonDiagnostics = true; }); return target; });
    await links.goto(new URL(page.url()).origin);
    destinations = await links.locator("[data-entrance]").evaluateAll(links =>
      Object.fromEntries(links.map(link => [link.dataset.entrance, link.href])));
  } finally { await linkContext.close(); }
  const address = new URL(page.url()), origin = address.origin, results = [];
  // Playwright 默认禁用 BFCache；单独启动允许缓存的浏览器，确保测到真实 persisted，而非合成事件。
  const browser = await page.context().browser().browserType().launch({ channel: "chrome", headless: true,
    ignoreDefaultArgs: ["--disable-back-forward-cache"] });
  const ordinaryBrowser = await page.context().browser().browserType().launch({ channel: "chrome", headless: true });
  try {
    for (const [viewportName, width, height] of [["desktop",1920,1080], ["phone",390,844], ["short",640,500]]) {
      if (address.searchParams.has("view") && address.searchParams.get("view") !== viewportName) continue;
      for (const kind of ["blog", "world"]) for (const historyMode of ["cached", "ordinary"]) {
        const name = `${viewportName}-${kind}-${historyMode}`;
        const context = await (historyMode === "cached" ? browser : ordinaryBrowser).newContext({
          viewport: { width, height }, isMobile: viewportName === "phone",
          hasTouch: viewportName === "phone", reducedMotion: "no-preference" });
        const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; }), events = [], errors = [];
        // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
        await context.route("**/*", route => new URL(route.request().url()).origin === origin
          ? route.continue() : route.abort());
        let inputTimer;
        target.setDefaultTimeout(35000);
        target.on("pageerror", error => errors.push(error.message));
        target.on("console", message => { if (message.text().startsWith("LIFECYCLE:")) events.push(JSON.parse(message.text().slice(10))); });
        try {
          await target.addInitScript(() => {
            // 验收专用探针：真实输入时间戳、逐帧间隔与长任务分开统计加载期和开幕后。
            const probe=window.__returnPerformance={inputs:[],frames:[],tasks:[],animationFrames:[]};
            const phase=()=>document.querySelector("#moon-loader")?"loading":"afterOpening";
            window.addEventListener("pointermove",event=>probe.inputs.push({time:performance.now(),phase:phase(),
              delay:Math.max(0,performance.now()-event.timeStamp)}));
            let previous;
            function frame(now) {
              if(previous!==undefined) probe.frames.push({time:now,phase:phase(),gap:now-previous});
              previous=now;requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
            new PerformanceObserver(list=>probe.tasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration,phase:phase()}))))
              .observe({type:"longtask",buffered:true});
            if(PerformanceObserver.supportedEntryTypes.includes("long-animation-frame"))
              new PerformanceObserver(list=>probe.animationFrames.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration,
                scripts:entry.scripts.map(script=>({source:script.sourceURL,function:script.sourceFunctionName,duration:script.duration}))}))))
                .observe({type:"long-animation-frame",buffered:true});
            const report = (event, persisted) => {
              const ink = document.querySelector("#ink-transition"), app = document.querySelector("#app"), loader = document.querySelector("#moon-loader");
              const rotor = loader?.querySelector(".hoop-rotor"), spin = rotor?.getAnimations().find(a => a.animationName === "hoop-spin");
              const matrix = rotor ? new DOMMatrixReadOnly(getComputedStyle(rotor).transform) : null;
              const data = { event, persisted, time: performance.now(), epoch: performance.timeOrigin + performance.now(),
                // 合成动画按文档时间轴采样；同时保留墙钟，单独暴露主线程迟到造成的绘制停顿。
                // 普通事件读取实际 CSS 文档帧；BFCache 的 pageshow 尚未刷新旧时间轴，刚同步对齐的金箍以墙钟核对。
                frameEpoch: performance.timeOrigin + (persisted && event === "pageshow-after"
                  ? performance.now() : document.timeline.currentTime ?? performance.now()),
                documentOrigin: performance.timeOrigin, animationTime: spin?.currentTime,
                angle: matrix ? ((Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) + 360) % 360 : null, url: location.href,
                state: app?.dataset.state, revealing: app?.dataset.revealing, returning: document.documentElement.dataset.moonReturning,
                loader: !!loader && loader.checkVisibility({ checkVisibilityCSS: true }), inert: app?.inert,
                rotorVisible: !!rotor && rotor.checkVisibility({ checkVisibilityCSS: true }),
                black: ink?.dataset.black === "true", canvas: ink?.querySelectorAll("canvas").length,
                inkColor: ink ? getComputedStyle(ink).backgroundColor : null,
                appVisible: app ? getComputedStyle(app).visibility : null,
                inkDisplay: ink ? getComputedStyle(ink).display : null,
                quoteVisible: document.querySelector("#inscription")?.dataset.visible };
              // 导航提交可能丢弃旧渲染进程的控制台消息，同步保存同源证据供真实回退后读取。
              if (app && event === "pagehide-after" && data.state === "redirect")
                sessionStorage.setItem("__lifecycleDeparture", JSON.stringify(data));
              if (app && event === "pageshow-after" && persisted) sessionStorage.setItem("__lifecycleReturn", JSON.stringify(data));
              console.log("LIFECYCLE:" + JSON.stringify(data));
            };
            // 只在验收中逐帧观察；生产代码仍只有创建时的一次 currentTime 对齐。
            let last = -Infinity, observing = false;
            function sample(now) {
              const loader = document.querySelector("#moon-loader");
              if (loader && !loader.classList.contains("revealing") && now - last >= 80) {
                report("hoop", false); last = now;
              }
              requestAnimationFrame(sample);
            }
            new MutationObserver(() => {
              if (!observing && document.querySelector("#moon-loader .hoop-rotor")) {
                observing = true;
                requestAnimationFrame(now => { report("hoop-initial", false); sample(now); });
              }
            }).observe(document, { childList: true, subtree: true });
            // 主模块在 load 之前注册清理；验收监听排在它后面，直接读取同步后置条件。
            window.addEventListener("load", () => {
              window.addEventListener("pagehide", event => report("pagehide-after", event.persisted));
              window.addEventListener("pageshow", event => report("pageshow-after", event.persisted));
            });
          });
          let navigations = 0;
          const destination = kind === "world" ? destinations.world : destinations.blog;
          await target.route(destination + "**", async route => {
            if (route.request().url().endsWith("delayed.css")) {
              await new Promise(resolve => setTimeout(resolve, 2500));
              await route.fulfill({ contentType: "text/css", body: "body { background: #2b5144; color: white; }" });
            } else {
              navigations++;
              await new Promise(resolve => setTimeout(resolve, 3000));
              await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><link rel="stylesheet" href="${destination}delayed.css"></head><body><h1>Delayed destination</h1></body></html>` });
            }
          });
          await target.goto(origin, { waitUntil: "domcontentloaded" });
          await target.bringToFront();
          await target.waitForFunction(() => document.querySelector("#app")?.dataset.state === "idle");
          await target.locator(`[data-entrance=${kind}]`).click({ noWaitAfter: true });
          await target.waitForURL(destination, { waitUntil: "load", timeout: 35000 });
          // 给恢复后的自动刷新一个可观察的网络窗口，截取真实回退加载态。
          await target.route(origin + "/", async route => {
            await new Promise(resolve => setTimeout(resolve, 2300));
            await route.continue();
          });
          // 新文档再等三个多周期，验证慢入口期间持续旋转，而不是只比较两个瞬时角度。
          await target.route(/\/assets\/index-[^/]+\.js$/, async route => {
            await new Promise(resolve => setTimeout(resolve, 5600));
            await route.continue();
          });
          const returnStart = events.length, returnEpoch = Date.now();
          // 使用已安装的系统 FFmpeg 编码 CDP 帧，不下载 Playwright 录制依赖。
          const cdp = await context.newCDPSession(target), frames = [], acknowledgements = [];
          cdp.on("Page.screencastFrame", event => {
            frames.push({ data: event.data, time: event.metadata.timestamp });
            acknowledgements.push(cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }));
          });
          await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 3 });
          // 在浏览器忙时仍持续提交真实鼠标事件；不用页面定时器制造一个无法测到阻塞的输入源。
          const dispatch=[],dispatches=[];
          let inputNumber=0;
          inputTimer=setInterval(()=>{
            const start=Date.now(),index=inputNumber++;
            const pending=cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:10+(index*17)%(width-20),y:10+(index*7)%(height-20),
              timestamp:start/1000}).then(()=>dispatch.push(Date.now()-start),error=>errors.push(error.message));
            dispatches.push(pending);
          },32);
          await target.goBack({ waitUntil: "commit" });
          await target.waitForFunction(() => !!document.querySelector("#moon-loader:not(.revealing)"));
          await target.screenshot({ path: `output/playwright/lifecycle-${name}-return-loader.png` });
          await target.waitForFunction(() => document.querySelector("#app")?.dataset.state === "idle" && !document.querySelector("#moon-loader"));
          await target.waitForFunction(()=>document.querySelectorAll('.entry-icon[data-model-ready="true"]').length===2);
          await target.waitForTimeout(1200);
          clearInterval(inputTimer);inputTimer=undefined;await Promise.all(dispatches);
          const performanceSample=await target.evaluate(()=>{
            const quantiles=values=>{
              values.sort((a,b)=>a-b);
              return {count:values.length,p95:values[Math.floor((values.length-1)*.95)]??0,p99:values[Math.floor((values.length-1)*.99)]??0,max:values.at(-1)??0};
            };
            const probe=window.__returnPerformance,measures=performance.getEntriesByType("measure").filter(entry=>entry.name.startsWith("moon-"))
              .map(entry=>({name:entry.name,start:entry.startTime,duration:entry.duration}));
            const canvas=document.querySelector("#scene canvas"),gl=canvas.getContext("webgl2"),debug=gl.getExtension("WEBGL_debug_renderer_info");
            return {renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,
              initialization:JSON.parse(document.querySelector("#scene").dataset.initialization),
              phases:Object.fromEntries(["loading","afterOpening"].map(phase=>[phase,{
                input:quantiles(probe.inputs.filter(entry=>entry.phase===phase).map(entry=>entry.delay)),
                frame:quantiles(probe.frames.filter(entry=>entry.phase===phase).map(entry=>entry.gap)),
                tasks:probe.tasks.filter(entry=>entry.phase===phase)}])),
              measures,animationFrames:probe.animationFrames};
          });
          const stored = await target.evaluate(() => ({ departure: JSON.parse(sessionStorage.getItem("__lifecycleDeparture") ?? "null"),
            restored: JSON.parse(sessionStorage.getItem("__lifecycleReturn") ?? "null") }));
          const departing = stored.departure;
          if (!departing?.black || departing.canvas !== 0 || departing.inkColor !== "rgb(0, 0, 0)" || navigations !== 1)
            throw new Error(`慢导航清理后黑场不稳定：${JSON.stringify({ name, departing, navigations, events })}`);
          const restored = stored.restored ? [stored.restored] : [];
          if ((restored.length > 0) !== (historyMode === "cached"))
            throw new Error(`历史模式没有真正覆盖：${JSON.stringify({ name, restored, events })}`);
          if (restored.some(event => !event.loader || !event.inert || event.returning !== "true" || event.state !== "loading"))
            throw new Error(`缓存恢复先露出旧文档：${JSON.stringify(restored)}`);
          const final = await target.evaluate(() => ({ failed: window.__moonBoot.failed,
            state: document.querySelector("#app").dataset.state, staleInk: document.querySelector("#ink-transition").dataset.black,
            staleQuote: document.querySelector("#inscription").dataset.visible }));
          if (final.failed || final.staleInk || final.staleQuote === "true" || errors.length)
            throw new Error(JSON.stringify({ name, final, errors }));
          const samples = [...restored, ...events.slice(returnStart).filter(event =>
            event.epoch >= returnEpoch && event.url === origin + "/" && event.loader && event.rotorVisible && typeof event.animationTime === "number")]
            .sort((a, b) => a.epoch - b.epoch);
          const distance = value => Math.abs(((value + 900) % 1800 + 1800) % 1800 - 900);
          const maxPhaseError = Math.max(...samples.map(sample => distance(sample.animationTime - sample.frameEpoch)));
          const maxJoinError = Math.max(0, ...samples.slice(1).map((sample, i) =>
            distance((sample.animationTime - samples[i].animationTime) - (sample.frameEpoch - samples[i].frameEpoch))));
          const maxTransformError = Math.max(...samples.map(sample => distance(sample.angle * 5 - sample.animationTime)));
          const span = samples.at(-1).epoch - samples[0].epoch;
          if (samples.length < 20 || span < 3600 || maxPhaseError > 100 || maxJoinError > 100 || maxTransformError > 2)
            throw new Error(`旋转进度不连续：${JSON.stringify({ name, span, maxPhaseError, maxJoinError, maxTransformError, samples })}`);
          if (samples.some(sample => (sample.appVisible !== null && sample.appVisible !== "hidden" && sample.revealing !== "true") ||
              (sample.returning === "true" && sample.inkDisplay !== "none")))
            throw new Error(`等待期间露出旧文档：${JSON.stringify({ name, samples })}`);
          await target.screenshot({ path: `output/playwright/lifecycle-${name}-returned-idle.png` });
          await cdp.send("Page.stopScreencast");
          await Promise.all(acknowledgements);
          if (frames.length < 30) throw new Error(`${name} 返回录制帧不足：${frames.length}`);
          const maxSamplingLag = Math.max(...samples.map(sample => sample.epoch - sample.frameEpoch));
          const maxRecordedGap = Math.max(...frames.slice(1).map((frame, i) => (frame.time - frames[i].time) * 1000));
          results.push({ name, navigations, departing, actualBackNavigation: true, bfcacheRestored: restored.length > 0,
            performance:performanceSample,dispatchMaximum:Math.max(...dispatch),
            restored, final, errors, sampleCount: samples.length, span, maxPhaseError, maxJoinError, maxTransformError,
            maxSamplingLag, maxRecordedGap,
            documentOrigins: [...new Set(samples.map(sample => sample.documentOrigin))], samples, frames });
        } finally { clearInterval(inputTimer);await context.close(); }
      }
    }
  } finally { await browser.close(); await ordinaryBrowser.close(); }
  return results;
}
