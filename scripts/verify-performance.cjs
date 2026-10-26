// 记录设备、视口与帧间隔；手机模拟仍使用桌面 GPU，不能据此宣称真机达到目标。
async (page) => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser();
  const results = [];
  for (const options of [
    {
      name: "desktop",
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1.75,
    },
    {
      name: "mobile-emulation",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    {
      name: "mobile-emulation-cpu4",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      cpuRate: 4,
    },
  ]) {
    const { name, cpuRate, ...contextOptions } = options;
    const context = await browser.newContext(contextOptions);
    const target = await context.newPage();
    const errors = [];
    target.on("pageerror", (error) => errors.push(error.message));
    if (cpuRate) {
      const cdp = await context.newCDPSession(target);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    }
    await target.goto(origin);
    await target.waitForFunction(
      () => document.querySelector("#app").dataset.state === "idle",
    );
    await target.waitForTimeout(500);
    const sample = await target.evaluate(
      () =>
        new Promise((resolve) => {
          const intervals = [],
            host = document.querySelector("#scene"),
            canvas = host.querySelector("canvas");
          let previous = 0,
            start = 0;
          const initialFrames = Number(host.dataset.frames);
          function frame(now) {
            if (!start) start = now;
            if (previous) intervals.push(now - previous);
            previous = now;
            if (now - start < 2500) requestAnimationFrame(frame);
            else {
              intervals.sort((a, b) => a - b);
              const gl = canvas.getContext("webgl2"),
                extension = gl.getExtension("WEBGL_debug_renderer_info");
              resolve({
                fps: Math.round((intervals.length * 1000) / (now - start)),
                renderedFps: Math.round(
                  ((Number(host.dataset.frames) - initialFrames) * 1000) /
                    (now - start),
                ),
                medianFrameMs:
                  +intervals[Math.floor(intervals.length * 0.5)].toFixed(2),
                p95FrameMs:
                  +intervals[Math.floor(intervals.length * 0.95)].toFixed(2),
                viewport: [innerWidth, innerHeight],
                buffer: [canvas.width, canvas.height],
                effectiveDpr: canvas.width / canvas.clientWidth,
                quality: host.dataset.quality,
                gpu: extension
                  ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                  : "unavailable",
                userAgent: navigator.userAgent,
                resources: JSON.parse(host.dataset.resources),
              });
            }
          }
          requestAnimationFrame(frame);
        }),
    );
    const cap = name === "desktop" ? 1.75 : 1.5;
    if (sample.effectiveDpr > cap + 0.01 || errors.length)
      throw new Error(JSON.stringify({ name, errors, sample }));
    results.push({ name, cpuRate: cpuRate ?? 1, ...sample, errors });
    await context.close();
  }
  return {
    capturedAt: new Date().toISOString(),
    mobileHardwareVerified: false,
    results,
  };
}
