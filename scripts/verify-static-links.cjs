// 自定义地址由测试页 URL 传入，所有导航均在浏览器边界拦截，不会访问真实博客。
async (page) => {
  const expected = new URL(page.url()).searchParams.get("expectedBlogUrl");
  if (!expected)
    throw new Error(
      "请在测试页 URL 的 expectedBlogUrl 中传入本次配置的博客地址",
    );
  const origin = new URL(page.url()).origin;
  const results = [];
  for (const javaScriptEnabled of [false, true]) {
    for (const selector of [
      "#static-box",
      "[data-entrance]",
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
        await target.route(expected, (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<h1>Configured blog reached</h1>",
          }),
        );
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
        if (hrefs.length !== 3 || hrefs.some((href) => href !== expected))
          throw new Error(
            `JS=${javaScriptEnabled} 静态入口未使用配置地址：${JSON.stringify(hrefs)}`,
          );
        await target.locator(selector).click();
        await target.waitForURL(expected);
        if (
          !(await target
            .getByRole("heading", { name: "Configured blog reached" })
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
