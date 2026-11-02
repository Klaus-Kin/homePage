// 生产预览回调；明确停止跨站请求后应重建主页，真实慢导航和替换导航必须仍能正常提交。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  await page.goto("about:blank");
  for (const mode of ["stop", "escape-legacy", "slow", "replace", "redirect"]) {
    for (const kind of ["blog", "world"]) {
      for (const reduced of mode === "stop" ? [false, true] : [true]) {
        const context = await page.context().browser().newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: reduced ? "reduce" : "no-preference" });
        await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        if (mode === "escape-legacy") await context.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined }));
        // 导航开始时在旧文档内记录门禁；请求挂起后不再 evaluate 旧执行上下文，避免执行器互等。
        await context.addInitScript(() => window.navigation?.addEventListener("navigate", () => {
          console.debug("CANCEL_CHECK:" + JSON.stringify({ epoch: performance.timeOrigin,
            state: document.querySelector("#app")?.dataset.state, black: document.querySelector("#ink-transition")?.dataset.black }));
        }));
        const target = await context.newPage(), errors = [];
        const commits = [];
        let outgoingState;
        target.on("pageerror", error => errors.push(error.message));
        target.on("framenavigated", frame => { if (frame === target.mainFrame()) commits.push(frame.url()); });
        target.on("console", message => { if (message.text().startsWith("CANCEL_CHECK:")) outgoingState = JSON.parse(message.text().slice(13)); });
        try {
          await target.goto(origin);
          await target.waitForSelector('#app[data-state="idle"]:not([inert])');
          const oldEpoch = await target.evaluate(() => performance.timeOrigin);
          const destination = await target.locator(`[data-entrance=${kind}]`).getAttribute("href");
          // 路由模拟的 302 后续请求由浏览器自己发出，使用预览服务的实际资源，避免访问外站或依赖第二次拦截。
          const redirected = `${origin}/assets/moon-lroc.jpg?controlled-navigation=redirect`;
          let requests = 0;
          await target.route(destination, async route => {
            requests++;
            if (mode === "redirect") {
              await route.fulfill({ status: 302, headers: { location: redirected } });
              return;
            }
            await new Promise(resolve => setTimeout(resolve, mode === "slow" ? 4500 : 2500));
            await route.fulfill({ contentType: "text/html", body: "<h1>Controlled delayed destination</h1>" }).catch(() => {});
          });
          await target.locator(`[data-entrance=${kind}] .entry-copy`).click({ noWaitAfter: true });
          for (let i = 0; !requests && i < 800; i++) await target.waitForTimeout(20);
          if (!requests) throw new Error("未观察到导航请求");
          if (mode === "slow") {
            await target.waitForTimeout(3000);
            if (commits.length !== 1 || new URL(target.url()).origin !== origin || outgoingState?.epoch !== oldEpoch
              || outgoingState.state !== "redirect" || outgoingState.black !== "true") throw new Error("慢导航被错误恢复");
            await target.waitForURL(destination);
          } else if (mode === "redirect") {
            // 正常 HTTP 重定向应完成出站，不能被旧文档的取消恢复路径打断。
            await target.waitForURL(redirected);
          } else if (mode === "replace") {
            const replacement = "https://replacement.invalid/";
            await target.route(replacement, route => route.fulfill({ contentType: "text/html", body: "<h1>Replacement</h1>" }));
            await target.goto(replacement);
            await target.waitForTimeout(100);
            if (target.url() !== replacement) throw new Error("旧取消回调抢占了新导航");
          } else {
            if (mode === "stop") await (await context.newCDPSession(target)).send("Page.stopLoading");
            else await target.keyboard.press("Escape");
            await target.waitForFunction(epoch => performance.timeOrigin !== epoch && document.querySelector("#app")?.dataset.state === "idle"
              && !document.querySelector("#moon-loader"), oldEpoch, { timeout: 30000 });
            const restored = await target.evaluate(() => ({ black: document.querySelector("#ink-transition")?.dataset.black,
              disabled: document.querySelector("#box-button").disabled,
              links: [...document.querySelectorAll("[data-entrance]")].map(link => ({ disabled: link.getAttribute("aria-disabled"), tab: link.tabIndex })) }));
            if (restored.black === "true" || restored.disabled || restored.links.some(link => link.disabled === "true" || link.tab < 0))
              throw new Error(JSON.stringify(restored));
            await target.screenshot({ path: `output/playwright/navigation-recovered-${mode}-${kind}-${reduced}.png` });
            // 恢复后再次选择另一入口，验证状态和目的地锁均真正重建，而非只撤掉黑色遮罩。
            const other = kind === "blog" ? "world" : "blog";
            const next = await target.locator(`[data-entrance=${other}]`).getAttribute("href");
            let repeats = 0;
            await target.route(next, route => { repeats++; return route.fulfill({ contentType: "text/html", body: "<h1>Retried journey</h1>" }); });
            await target.emulateMedia({ reducedMotion: "reduce" });
            await target.locator(`[data-entrance=${other}]`).click({ noWaitAfter: true });
            await target.waitForURL(next);
            if (repeats !== 1) throw new Error("恢复后的入口重复导航");
          }
          if (requests !== 1 || errors.length) throw new Error(JSON.stringify({ requests, errors }));
          results.push({ mode, kind, reduced, requests, passed: true });
        } finally { await context.close(); }
      }
    }
  }
  return results;
}
