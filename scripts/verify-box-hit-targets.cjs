// 验证真实鼠标命中与导航，覆盖临界视口中的透明介绍区、运行降级和无脚本入口。
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
  const results = [];
  // 平板复现点覆盖盒面上缘，分别验证正常、降级及原生入口的真实点击行为。
  const cases = ["normal", "no-webgl", "module-failure", "no-script"].flatMap(mode =>
    [[640, 500], [768, 721], [800, 721]].flatMap(([width, height]) =>
      // 平板运行模式同时检查鼠标与原生触屏轻触，防止只修复其中一种输入。
      (width !== 640 && (mode === "normal" || mode === "no-webgl") ? [false, true] : [false])
        .map(touch => ({ mode, width, height, touch }))));
  for (const { mode, width, height, touch } of cases) {
    const context = await page.context().browser().newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: touch,
      javaScriptEnabled: mode !== "no-script",
    });
    try {
      const target = await context.newPage();
      // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
      await context.route("**/*", route => new URL(route.request().url()).origin === origin
        ? route.continue() : route.abort());
      if (mode === "no-webgl") {
        await target.addInitScript(() => {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return /webgl/i.test(type) ? null : getContext.call(this, type, ...args);
          };
        });
      }
      if (mode === "module-failure")
        await target.route(/\/(?:src\/main\.ts|assets\/index-[^/]+\.js)(?:\?|$)/, (route) => route.abort());
      await target.route(destinations.blog, (route) => route.fulfill({
        contentType: "text/html", body: "<h1>Box destination reached</h1>",
      }));
      await target.goto(origin);
      if (mode !== "no-script")
        await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      const id = mode === "module-failure" || mode === "no-script" ? "static-box" : "box-button";
      // trial 仍执行浏览器的遮挡检查，确保透传规则没有牺牲正文链接的点击能力。
      await target.locator(".journey-link[data-entrance=blog]").click({ trial: true });
      // 指针透传不应影响键盘可访问性；链接与宝盒仍必须能接收焦点。
      for (const selector of ["[data-entrance=blog]", "[data-entrance=world]", `#${id}`]) {
        await target.locator(selector).focus();
        if (!(await target.locator(selector).evaluate((element) => document.activeElement === element)))
          throw new Error(`${mode}: 入口无法获得键盘焦点 ${selector}`);
      }
      const reproductionPoint = width === 640 ? { x: 347, y: 424 } : { x: 400, y: 615 };
      const hit = await target.evaluate(({ id, reproductionPoint, touch }) => {
        const box = document.getElementById(id).getBoundingClientRect();
        const points = [];
        for (const x of [0.2, 0.5, 0.8])
          for (const y of [0.1, 0.5, 0.9])
            points.push({ x: box.x + box.width * x, y: box.y + box.height * y });
        // 审查复现点位于正常场景的盒面上缘，中心点检查无法发现这里的遮挡。
        // 粗指针沿用既有轻量场景和实体位置，固定桌面坐标只用于鼠标复现；触屏检查实际盒面网格。
        if (!touch && id === "box-button" && !document.querySelector("#app").classList.contains("fallback"))
          points.push(reproductionPoint);
        return { box: box.toJSON(), points: points.map((point) => ({
          ...point, target: document.elementFromPoint(point.x, point.y)?.id,
        })) };
      }, { id, reproductionPoint, touch });
      if (hit.points.some((point) => point.target !== id))
        throw new Error(`宝盒点击被拦截：${JSON.stringify({ mode, width, height, touch, id, ...hit })}`);
      await target.screenshot({ path: `output/playwright/box-hit-${mode}-${width}x${height}.png` });
      // 正常鼠标模式点击原始复现点，其余模式点击盒面上缘，验证提示和原生链接的真实响应。
      const point = mode === "normal" && !touch ? reproductionPoint : hit.points[0];
      if (touch) await target.touchscreen.tap(point.x, point.y);
      else await target.mouse.click(point.x, point.y);
      if (mode === "normal" || mode === "no-webgl") {
        if (await target.locator("#app").getAttribute("data-state") !== "idle") throw new Error("宝盒误启动转场");
        // 实际落点必须触发选择提示，不能只因状态尚未更新而把未命中误认为成功。
        if (await target.locator('#journey-choices').getAttribute('data-prompt') !== 'true') throw new Error("宝盒未提示选择");
        if (touch) await target.locator("[data-entrance=blog]").tap();
        else await target.locator("[data-entrance=blog]").click();
        // 正文链接恢复命中后，转场仍须关闭其指针输入，防止重复触发入口。
        const locked = await target.locator(".journey-link[data-entrance=blog]").evaluate((element) =>
          getComputedStyle(element).pointerEvents === "none" &&
          document.querySelector("#app").dataset.state === "transition");
        if (!locked) throw new Error(`${mode}: 转场未锁定正文入口`);
      }
      if (mode === "module-failure" || mode === "no-script") {
        await target.waitForURL(`${origin}/#journey-choices`);
        await target.locator("[data-entrance=blog]").click();
      }
      await target.waitForURL(destinations.blog);
      results.push({ mode, width, height, touch, pointsChecked: hit.points.length, box: hit.box, navigated: true });
    } finally {
      await context.close();
    }
  }
  return results;
}
