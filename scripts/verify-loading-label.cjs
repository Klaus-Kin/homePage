// 通过 Playwright CLI run-code --filename 执行；页面须先打开生产预览地址。
// 限速用 Chromium 网络仿真，让真实 HTML 解析过程暴露逐字补齐问题，不替换欢迎语或暂停它的脚本。
async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser(), results = [];
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    for (const { slow, reduced } of [{ slow: false, reduced: false }, { slow: true, reduced: false }, { slow: true, reduced: true }]) {
      const context = await browser.newContext({ viewport, reducedMotion: reduced ? "reduce" : "no-preference" });
      try {
        const target = await context.newPage(), errors = [];
        target.on("pageerror", error => errors.push(error.message));
        if (slow) {
          const client = await context.newCDPSession(target);
          await client.send("Network.enable");
          await client.send("Network.emulateNetworkConditions", {
            offline: false, latency: 80, downloadThroughput: 160000, uploadThroughput: 64000,
          });
        }
        // DOM 变化与每次绘制前都检查，首次可见时必须拥有九个可渲染引用；后续也不能出现缺字帧。
        await target.addInitScript(() => {
          window.__welcomeReview = { visibleSamples: 0, incomplete: [], first: null };
          const inspect = () => {
            const label = document.querySelector("#moon-loader .loading-label");
            if (!label || getComputedStyle(label).visibility !== "visible") return;
            const uses = [...label.querySelectorAll("use")];
            const snapshot = {
              text: label.textContent.trim(), count: uses.length,
              complete: uses.length === 9 && uses.every(use => {
                const symbol = document.getElementById(use.getAttribute("href").slice(1));
                const bounds = use.getBBox();
                return symbol?.querySelector("path")?.getAttribute("d") && bounds.width > 0 && bounds.height > 0;
              }),
              time: performance.now(), readyState: document.readyState,
            };
            const review = window.__welcomeReview;
            review.visibleSamples++;
            if (!review.first) review.first = snapshot;
            if (!snapshot.complete) review.incomplete.push(snapshot);
          };
          new MutationObserver(inspect).observe(document, { subtree: true, childList: true, attributes: true });
          const frame = () => { inspect(); requestAnimationFrame(frame); };
          requestAnimationFrame(frame);
        });
        await target.goto(origin, { waitUntil: "commit" });
        await target.waitForFunction(() => window.__welcomeReview?.first);
        await target.screenshot({ path: `output/playwright/welcome-${viewport.width}-${slow ? "slow" : "normal"}${reduced ? "-reduced" : ""}.png` });
        await target.waitForSelector('#app[data-state="idle"]:not([inert])');
        const review = await target.evaluate(() => window.__welcomeReview);
        if (!review.first.complete || review.first.text !== "月色正好,欢迎来访" || review.incomplete.length || errors.length)
          throw new Error(JSON.stringify({ viewport, slow, reduced, review, errors }));
        results.push({ viewport, slow, reduced, ...review, errors });
      } finally { await context.close(); }
    }
  }
  return results;
}
