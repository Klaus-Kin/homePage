// 生产预览注入有固定终点的真实慢帧，验证持续降档、原生光标和稳定后的保守恢复。
async (page) => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(() => { window.__moonDiagnostics = true; });
  const target = await context.newPage(), errors = [];
  target.on("pageerror", error => errors.push(error.message));
  try {
    await target.goto(origin);
    await target.waitForSelector('#app[data-state="idle"]:not([inert])', { timeout: 60000 });
    await target.waitForFunction(() => document.querySelectorAll('.entry-icon[data-model-ready="true"]').length === 2);
    await target.mouse.move(100, 100);
    const read = () => target.evaluate(() => ({ level: Number(document.querySelector("#scene").dataset.performanceLevel ?? 0),
      resources: JSON.parse(document.querySelector("#scene").dataset.resources),
      native: document.documentElement.classList.contains("staff-cursor-native"),
      width: document.querySelector("#scene canvas").width,
      fallback: document.querySelector("#app").classList.contains("fallback") }));
    const before = await read();
    await target.evaluate(() => {
      const end = performance.now() + 7000;
      const slow = () => { const until = performance.now() + 45;
        while (performance.now() < until) { /* 验收专用主线程负载，到时立即停止。 */ }
        if (performance.now() < end) requestAnimationFrame(slow);
      };
      requestAnimationFrame(slow);
    });
    await target.waitForTimeout(7400);
    const lowered = await read();
    if (lowered.level < 1 || !lowered.native || lowered.width >= before.width ||
      lowered.resources.triangles >= before.resources.triangles || lowered.resources.shadowSize >= before.resources.shadowSize)
      throw new Error(JSON.stringify({ before, lowered }));
    await target.waitForFunction(() => document.querySelector("#scene").dataset.performanceLevel === "0", undefined, { timeout: 23000 });
    const recovered = await read();
    if (errors.length || recovered.fallback || recovered.width !== before.width ||
      recovered.resources.triangles !== before.resources.triangles || recovered.resources.shadowSize !== before.resources.shadowSize)
      throw new Error(JSON.stringify({ before, lowered, recovered, errors }));
    return { before, lowered, recovered, errors, physicalDeviceVerified: false };
  } finally { await context.close(); }
}
