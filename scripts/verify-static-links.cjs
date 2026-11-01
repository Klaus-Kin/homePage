// 自定义地址由测试页 URL 传入，所有导航均在浏览器边界拦截，不会访问真实博客。
async (page) => {
  const expected = new URL(page.url()).searchParams.get("expectedBlogUrl");
  const world = new URL(page.url()).searchParams.get("expectedWorldUrl");
  if (!expected || !world)
    throw new Error(
      "请在测试页 URL 中显式传入 expectedBlogUrl 和 expectedWorldUrl 两个预期地址",
    );
  const origin = new URL(page.url()).origin;
  const results = [];
  for (const javaScriptEnabled of [false, true]) {
    for (const selector of [
      "#static-box",
      "[data-entrance=blog]",
      "[data-entrance=world]",
      ".noscript-entry a",
    ]) {
      const context = await page
        .context()
        .browser()
        .newContext({
          javaScriptEnabled,
          viewport: { width: 390, height: 844 },
        });
      try {
        const target = await context.newPage();
        // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
        await context.route("**/*", route => new URL(route.request().url()).origin === origin
          ? route.continue() : route.abort());
        await target.route(expected, (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<h1>Configured blog reached</h1>",
          }),
        );
        await target.route(world, route => route.fulfill({ contentType: "text/html", body: "<h1>Configured world reached</h1>" }));
        if (javaScriptEnabled)
          await target.route(
            /\/(?:src\/main\.ts|assets\/index-[^/]+\.js)(?:\?|$)/,
            (route) => route.abort(),
          );
        await target.goto(origin);
        if (javaScriptEnabled) await target.waitForSelector("#app.boot-failed");
        const hrefs = await target
          .locator("#static-box, [data-entrance], .noscript-entry a")
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute("href")),
          );
        if (hrefs.length !== 4 || hrefs[0] !== "#journey-choices" || hrefs[1] !== expected || hrefs[2] !== world || hrefs[3] !== expected)
          throw new Error(
            `JS=${javaScriptEnabled} 静态入口未使用配置地址：${JSON.stringify(hrefs)}`,
          );
        await target.locator(selector).click();
        // 无脚本及启动失败时宝盒只把焦点定位到选项区域，文字链接保留各自原生地址。
        if (selector === "#static-box") {
          await target.waitForURL(`${origin}/#journey-choices`);
          await target.locator("[data-entrance=blog]").click();
        }
        await target.waitForURL(selector === "[data-entrance=world]" ? world : expected);
        if (
          !(await target
            .getByRole("heading", { name: selector === "[data-entrance=world]" ? "Configured world reached" : "Configured blog reached" })
            .isVisible())
        )
          throw new Error("未到达测试博客");
        results.push({
          javaScriptEnabled,
          selector,
          configuredEntryWorks: true,
        });
      } finally {
        await context.close();
      }
    }
  }
  return results;
}
