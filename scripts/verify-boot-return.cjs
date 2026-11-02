// 真实离页和历史返回；分别启用、禁用 BFCache，确认新揭幕时长不会破坏旧页面遮挡与重新就绪。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const cached of [true, false]) {
    const browser = await page.context().browser().browserType().launch({ channel: "chrome", headless: true,
      ...(cached ? { ignoreDefaultArgs: ["--disable-back-forward-cache"] } : {}) });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      await context.addInitScript(() => {
        // 在 load 时注册，确保监听顺序晚于 HTML 同步恢复守卫；事件监听器之间的微任务不能保证这个顺序。
        addEventListener("load", () => addEventListener("pageshow", event => {
          if (event.persisted) {
            // 恢复守卫同步显露欢迎语；真实历史返回时也必须拥有全部九个可绘制字形。
            const label = document.querySelector("#moon-loader .loading-label");
            const uses = [...(label?.querySelectorAll("use") ?? [])];
            sessionStorage.setItem("__bootReturn", JSON.stringify({ persisted: true,
              loader: !!document.querySelector("#moon-loader"),
              welcomeComplete: !!label && getComputedStyle(label).visibility === "visible" && uses.length === 9 &&
                uses.every(use => { const bounds = use.getBBox(); return bounds.width > 0 && bounds.height > 0; }),
              state: document.querySelector("#app")?.dataset.state,
              returning: document.documentElement.dataset.moonReturning,
            }));
          }
        }));
      });
      const target = await context.newPage(), errors = [];
      // 未匹配受控目的页的外部请求一律中止，防止验收意外访问真实站点。
      await context.route("**/*", route => new URL(route.request().url()).origin === origin
        ? route.continue() : route.abort());
      target.on("pageerror", error => errors.push(error.message));
      await target.goto(origin);
      await target.waitForSelector('#app[data-state="idle"]:not([inert])');
      const initialOrigin = await target.evaluate(() => performance.timeOrigin);
      const destination = await target.locator("[data-entrance=blog]").getAttribute("href");
      await target.route(destination, route => route.fulfill({ contentType: "text/html", body: "<h1>Local return destination</h1>" }));
      await target.locator("[data-entrance=blog]").click();
      await target.waitForURL(destination);
      await target.goBack({ waitUntil: "commit" });
      await target.waitForFunction(previous => performance.timeOrigin !== previous &&
        document.querySelector("#app")?.dataset.state === "idle" && !document.querySelector("#moon-loader"), initialOrigin);
      const restored = await target.evaluate(() => ({
        cached: JSON.parse(sessionStorage.getItem("__bootReturn") ?? "null"),
        fallback: document.querySelector("#app").classList.contains("fallback"),
        inert: document.querySelector("#app").inert,
        black: document.querySelector("#ink-transition")?.dataset.black === "true",
      }));
      if (restored.inert || restored.black || restored.fallback || errors.length ||
          (cached && (!restored.cached?.persisted || !restored.cached.loader || !restored.cached.welcomeComplete || restored.cached.state !== "loading")))
        throw new Error(JSON.stringify({ cached, restored, errors }));
      await target.screenshot({ path: `output/playwright/startup-return-${cached ? "cached" : "ordinary"}.png` });
      results.push({ mode: cached ? "cached" : "ordinary", restored, errors });
    } finally { await browser.close(); }
  }
  return results;
}
