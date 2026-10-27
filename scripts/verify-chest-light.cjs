// 在独立浏览器上下文检查真实光源；验收注入只存在于被拦截的开发模块，不进入生产代码。
async (page) => {
  const origin = new URL(page.url()).origin, results = [];
  for (const [name, width, height, trigger] of [
    ['pc-box', 1920, 1080, '#box-button'], ['pc-link', 2560, 1080, '[data-entrance]'],
    ['phone-box', 390, 844, '#box-button'], ['phone-link', 390, 844, '[data-entrance]'],
  ]) {
    const context = await page.context().browser().newContext({ viewport: { width, height } });
    try {
      const target = await context.newPage(), errors = [];
      target.on('pageerror', error => errors.push(error.message));
      await target.route(/\/src\/scene\.ts(?:\?|$)/, async route => {
        const response = await route.fetch(), source = await response.text();
        const body = source.replace('const firstSubmit = performance.now();',
          'window.__lightReview = { chest }; const firstSubmit = performance.now();');
        if (body === source) throw new Error('光源检查注入失败');
        await route.fulfill({ response, body });
      });
      await target.clock.install(); await target.clock.pauseAt(new Date(Date.now() + 1000));
      await target.goto(origin); await target.waitForSelector('#app[data-state="idle"]');
      async function sample() {
        return target.evaluate(() => {
          const { chest } = window.__lightReview, channels = [];
          chest.box.traverse(object => {
            if (['cavity-light', 'cavity-glow', 'cavity-halo'].includes(object.name))
              channels.push({ name: object.name, value: object.isLight ? object.intensity : object.material.opacity, visible: object.visible });
          });
          const title = [...document.querySelectorAll('.seal-title')];
          return { channels, position: chest.box.position.toArray(), scale: chest.box.scale.toArray(),
            angle: +document.querySelector('#scene').dataset.lidAngle,
            title: title.map(el => ({ color: getComputedStyle(el).color, paths: el.querySelectorAll('path').length })) };
        });
      }
      const idle = await sample(), phone = width < 768;
      if (idle.channels.length !== 6 || idle.channels.some(channel => channel.value !== 0 || channel.visible) ||
        JSON.stringify(idle.position) !== JSON.stringify(phone ? [.3, 0, 6.9] : [-.7, 0, 5.5]) ||
        idle.scale.some(value => value !== .64) || idle.title.length !== 2 ||
        idle.title[0].color !== 'rgb(230, 232, 237)' || idle.title[1].color !== 'rgb(228, 204, 160)' ||
        idle.title.some(line => line.paths < 4)) throw new Error(`${name}: ${JSON.stringify(idle)}`);
      await target.locator(trigger).click();
      await target.clock.runFor(160); const early = await sample();
      await target.clock.runFor(240); const middle = await sample();
      await target.clock.runFor(432); const open = await sample();
      for (let i = 0; i < idle.channels.length; i++) {
        if (!(early.channels[i].value > 0 && middle.channels[i].value > early.channels[i].value && open.channels[i].value >= middle.channels[i].value))
          throw new Error(`${name}: 光源未随开盖递增 ${JSON.stringify({ early, middle, open })}`);
      }
      if (!early.angle || open.angle !== 180 || errors.length) throw new Error(JSON.stringify({ name, early, open, errors }));
      results.push({ name, idle, early, middle, open, errors });
    } finally { await context.close(); }
  }
  return results;
}
