// 验证真实鼠标命中与导航，覆盖临界视口中的透明介绍区、运行降级和无脚本入口。
async (page) => {
  const origin = new URL(page.url()).origin;
  const results = [];
  for (const mode of ["normal", "no-webgl", "module-failure", "no-script"]) {
    const context = await page.context().browser().newContext({
      viewport: { width: 640, height: 500 },
      reducedMotion: "reduce",
      javaScriptEnabled: mode !== "no-script",
    });
    try {
      const target = await context.newPage();
      if (mode === "no-webgl") {
        await target.addInitScript(() => {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return /webgl/i.test(type) ? null : getContext.call(this, type, ...args);
          };
        });
      }
      if (mode === "module-failure")
        await target.route(/\/src\/main\.ts(?:\?|$)/, (route) => route.abort());
      await target.route("https://example.com/blog", (route) => route.fulfill({
        contentType: "text/html", body: "<h1>Box destination reached</h1>",
      }));
      await target.goto(origin);
      if (mode !== "no-script")
        await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      const id = mode === "module-failure" || mode === "no-script" ? "static-box" : "box-button";
      // trial 仍执行浏览器的遮挡检查，确保透传规则没有牺牲正文链接的点击能力。
      await target.locator(".journey-link").click({ trial: true });
      // 指针透传不应影响键盘可访问性；链接与宝盒仍必须能接收焦点。
      for (const selector of [".journey-link", `#${id}`]) {
        await target.locator(selector).focus();
        if (!(await target.locator(selector).evaluate((element) => document.activeElement === element)))
          throw new Error(`${mode}: 入口无法获得键盘焦点 ${selector}`);
      }
      const hit = await target.evaluate((id) => {
        const box = document.getElementById(id).getBoundingClientRect();
        const points = [];
        for (const x of [0.2, 0.5, 0.8])
          for (const y of [0.1, 0.5, 0.9])
            points.push({ x: box.x + box.width * x, y: box.y + box.height * y });
        // 审查复现点位于正常场景的盒面上缘，中心点检查无法发现这里的遮挡。
        if (id === "box-button" && !document.querySelector("#app").classList.contains("fallback"))
          points.push({ x: 347, y: 424 });
        return { box: box.toJSON(), points: points.map((point) => ({
          ...point, target: document.elementFromPoint(point.x, point.y)?.id,
        })) };
      }, id);
      if (hit.points.some((point) => point.target !== id))
        throw new Error(`宝盒点击被拦截：${JSON.stringify({ mode, id, ...hit })}`);
      await target.screenshot({ path: `output/playwright/box-hit-${mode}-640x500.png` });
      // 正常模式点击原始复现点；静态模式点击中心，验证原生链接也能真实导航。
      const point = mode === "normal" ? { x: 347, y: 424 } : hit.points[4];
      await target.mouse.click(point.x, point.y);
      if (mode === "normal" || mode === "no-webgl") {
        // 正文链接恢复命中后，转场仍须关闭其指针输入，防止重复触发入口。
        const locked = await target.locator(".journey-link").evaluate((element) =>
          getComputedStyle(element).pointerEvents === "none" &&
          document.querySelector("#app").dataset.state === "transition");
        if (!locked) throw new Error(`${mode}: 转场未锁定正文入口`);
      }
      await target.waitForURL("https://example.com/blog");
      results.push({ mode, pointsChecked: hit.points.length, box: hit.box, navigated: true });
    } finally {
      await context.close();
    }
  }
  return results;
}
