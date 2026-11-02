// 记录连续视频、浏览器合成原因与长任务，覆盖冷/热启动及三种构图的 CPU 降速。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin;
  const results = [];
  const recordings = [];
  for (const [name, width, height] of [["landscape", 1366, 768], ["phone", 390, 844], ["portrait", 1024, 1366]]) {
    for (const rate of [1, 4]) {
      const context = await page.context().browser().newContext({ viewport: { width, height } });
      let release, recording = true;
      try {
      await context.addInitScript(() => {
        window.__startup = { longTasks: [], frames: [], ready: 0 };
        new PerformanceObserver((list) => window.__startup.longTasks.push(...list.getEntries().map(
          (entry) => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: "longtask", buffered: true });
        const sample = (now) => {
          if (!document.querySelector("#moon-loader") && document.querySelector("#app")) {
            window.__startup.ready = now; return;
          }
          window.__startup.frames.push(now); requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const target = await context.newPage().then(async target => { await context.addInitScript(() => { window.__moonDiagnostics = true; }); return target; });
      await target.bringToFront();
      const errors = []; target.on("pageerror", (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(target);
      // LayerTree 依赖页面与 DOM 域启用，否则部分 Chrome 版本不会推送图层事件。
      // 使用浏览器合成帧录屏，不依赖额外安装的 Playwright 编码器。
      const frames = [], directory = `output/playwright/initialization-${name}-cpu${rate}`;
      cdp.on("Page.screencastFrame", (event) => {
        frames.push({ data: event.data, time: event.metadata.timestamp });
        void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch((error) => {
          // 停止录制后允许关闭连接；录制期间的协议错误仍应使验收失败。
          if (recording) errors.push(error.message);
        });
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      let latestLayers = [];
      cdp.on("LayerTree.layerTreeDidChange", (event) => { latestLayers = event.layers ?? []; });
      const gate = new Promise((resolve) => { release = resolve; });
      const pattern = /\/(?:src\/scene\.ts|assets\/scene-[^/]+\.js)(?:\?|$)/;
      await target.route(pattern, async (route) => { await gate; await route.continue(); });
      for (const cache of ["cold", "warm"]) {
        await target.goto(origin, { waitUntil: "domcontentloaded" });
        await cdp.send("Page.enable");
        await cdp.send("DOM.enable");
        await cdp.send("Runtime.enable");
        await cdp.send("LayerTree.enable");
        await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
        let compositing = [];
        if (cache === "cold") {
          await target.screenshot({ path: `output/playwright/initialization-${name}-cpu${rate}-loader.png` });
          await target.waitForTimeout(150);
          const { root } = await cdp.send("DOM.getDocument");
          const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".hoop-rotor" });
          const { node } = await cdp.send("DOM.describeNode", { nodeId });
          const layer = latestLayers.find((item) => item.backendNodeId === node.backendNodeId);
          if (layer) compositing = (await cdp.send("LayerTree.compositingReasons", { layerId: layer.layerId })).compositingReasons;
          if (!compositing.some((reason) => /active accelerated transform animation/i.test(reason))) {
            const details = [];
            for (const item of latestLayers) details.push({ ...item,
              reasons: (await cdp.send("LayerTree.compositingReasons", { layerId: item.layerId })).compositingReasons });
            recording = false; release(); await context.close();
            throw new Error(`旋转层未加速：${JSON.stringify({ compositing, node, details })}`);
          }
          release();
        }
        await target.waitForSelector('#app[data-state="idle"]', { timeout: 20000 });
        await target.waitForTimeout(100);
        const sample = await target.evaluate(() => {
          const host = document.querySelector("#scene"), start = performance.getEntriesByName("moon-generation-start")[0]?.startTime,
            end = performance.getEntriesByName("moon-generation-end")[0]?.startTime;
          return { ...window.__startup, start, end, stats: JSON.parse(host.dataset.initialization ?? "null"),
            fallback: document.querySelector("#app").classList.contains("fallback"), firstFrames: host.dataset.frames };
        });
        if (sample.fallback || !sample.stats || errors.length) throw new Error(JSON.stringify({ name, rate, cache, errors, sample }));
        // 上下文创建是同步浏览器工作，单独列出；门禁针对应用生成批次。
        const maximumBatch = Math.max(...sample.stats.batches.filter((_, i) => sample.stats.phases[i] !== "setup"));
        const generationLongTasks = sample.longTasks.filter((task) => task.start >= sample.start && task.start < sample.end);
        if (maximumBatch >= 50 || generationLongTasks.length)
          throw new Error(`生成阶段超过 50ms：${JSON.stringify({ name, rate, cache, maximumBatch, generationLongTasks,
            phases: sample.stats.batches.map((ms, i) => ({ ms, phase: sample.stats.phases[i] })).filter((batch) => batch.ms >= 30) })}`);
        results.push({ name, rate, cache, compositing, ...sample, maximumBatch });
        await cdp.send("Page.stopScreencast");
        if (cache === "cold") await target.unroute(pattern);
      }
      recording = false;
      await context.close();
      recordings.push({ directory, frames });
      } finally {
        recording = false;
        release?.();
        await context.close();
      }
    }
  }
  // 结果保存为独立产物，生成批次与首次 GPU 提交可分别审阅。
  return { results, recordings };
}
