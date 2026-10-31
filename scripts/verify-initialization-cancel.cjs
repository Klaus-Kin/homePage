// 在真实生成流程中取消，验证半成品资源、独立纹理和 WebGL 上下文均被释放。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const event of ["moon-boot-failed", "pagehide"]) {
    // 植被流程已有细分阶段；使用确实会执行检查点的岩石阶段，并覆盖本轮调整的上传与预热等待。
    for (const phase of ["mountain-0", "weathered-rock-geometry", "meadow-turf-desktop", "meadow-flowers-mobile", "wood-spell",
      "gpu-textures", "gpu-choice-1", "gpu-opening-3"]) {
      const context = await page.context().browser().newContext();
      try {
        const target = await context.newPage();
        // 读取场景实际导入的类，兼容 Vite 为热更新依赖附加的时间戳。
        await target.route(/\/src\/scene\/initialization\.ts(?:\?|$)/, async (route) => {
          const response = await route.fetch();
          await route.fulfill({ response, body: `${await response.text()}\nwindow.__reviewInitialization = Initialization;` });
        });
        await target.route("**/__cancel-review", (route) => route.fulfill({ contentType: "text/html",
          body: '<div id="scene" style="width:800px;height:600px"></div><button></button>' }));
        await target.goto(`${origin}/__cancel-review`);
        const result = await target.evaluate(async ({ event, phase }) => {
          const { createScene } = await import("/src/scene.ts");
          const Initialization = window.__reviewInitialization;
          const tracked = new Map(), contexts = [];
          const originalTrack = Initialization.prototype.track, checkpoint = Initialization.prototype.checkpoint;
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (...args) {
            const value = getContext.apply(this, args);
            if (/webgl/.test(args[0]) && value) contexts.push(value);
            return value;
          };
          Initialization.prototype.track = function (item) {
            if (!tracked.has(item)) {
              tracked.set(item, 0);
              item.addEventListener("dispose", () => tracked.set(item, tracked.get(item) + 1));
            }
            return originalTrack.call(this, item);
          };
          let cancelled, checks = 0;
          Initialization.prototype.checkpoint = function (force) {
            checks++;
            if (!cancelled && this.phase === phase) {
              cancelled = this;
              window.dispatchEvent(event === "pagehide" ? new PageTransitionEvent(event) : new Event(event));
            }
            return checkpoint.call(this, force);
          };
          let rejected = false;
          try { await createScene(document.querySelector("#scene"), document.querySelector("button"), () => {}); }
          catch (error) { if (error.name !== "AbortError") throw error; rejected = true; }
          const stopped = checks;
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (!rejected || !cancelled?.controller.signal.aborted || checks !== stopped ||
            document.querySelector("canvas") || cancelled.resources.size || cancelled.cleanups.size ||
            [...tracked.values()].some((count) => count !== 1) || contexts.some((gl) => !gl.isContextLost()))
            throw new Error(`取消后仍有资源或生成任务：${JSON.stringify({ event, phase, rejected,
              aborted: cancelled?.controller.signal.aborted, checks, stopped,
              canvas: !!document.querySelector("canvas"), resources: cancelled?.resources.size,
              cleanups: cancelled?.cleanups.size, counts: [...tracked].map(([item, count]) => ({ type: item.type ?? item.constructor.name, count })),
              contexts: contexts.map((gl) => gl.isContextLost()) })}`);
          return { event, phase, releasedResources: tracked.size, stopped: true, contextLost: true };
        }, { event, phase });
        results.push(result);
      } finally { await context.close(); }
    }
  }
  // 连续交错切换画质，等所有旧请求结束后，实例数必须仍对应最后一次选择。
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const target = await context.newPage();
    await target.route("**/__quality-review", (route) => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await target.goto(`${origin}/__quality-review`);
    const quality = await target.evaluate(async () => {
      const { Initialization } = await import("/src/scene/initialization.ts");
      const { createTerrain } = await import("/src/scene/terrain.ts");
      const init = new Initialization(), terrain = await createTerrain(init);
      const meshes=[]; terrain.group.traverse(item=>{ if(item.isInstancedMesh) meshes.push(item); });
      // 先串行取得各模式的稳定数量：各层植被独立预算，PC 岩石避让也可能减少实例数。
      // 基线与并发检查复用同一地形，避免硬编码数量后随生成规则变化再次产生误报。
      const baseline = new Map();
      for (const mobile of [true, false]) {
        await terrain.setQuality(mobile);
        baseline.set(mobile, meshes.map((mesh) => mesh.count));
      }
      const transitions = [];
      for (const choices of [[true, false, true], [false, true, false]]) {
        await Promise.all(choices.map((mobile) => terrain.setQuality(mobile)));
        const expected = baseline.get(choices.at(-1));
        const actual = meshes.map((mesh) => mesh.count);
        if (actual.some((count, i) => count !== expected[i]))
          throw new Error(`旧画质请求覆盖了最终植被数量：${JSON.stringify({ choices, expected, actual })}`);
        transitions.push({ choices, expected, actual });
      }
      init.dispose();
      return { rapidQualityChanges: true, transitions, finalCounts: meshes.map((mesh) => mesh.count), released: init.resources.size === 0 };
    });
    results.push(quality);
  } finally { await context.close(); }
  return results;
}
