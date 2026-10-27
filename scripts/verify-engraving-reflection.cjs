// 冻结生产场景，仅切换刻字照地光，读取真实 GPU 像素并保留逐帧验收截图。
async (page) => {
  const origin = new URL(page.url()).origin, results = [], errors = [];
  await page.bringToFront();
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/scene\.ts(?:\?|$)/, async route => {
    const response = await route.fetch(), source = await response.text();
    const body = source.replace('const firstSubmit = performance.now();',
      'window.__reflectionReview = { chest, renderer, scene, camera, terrain }; const firstSubmit = performance.now();');
    if (body === source) throw new Error('反光检查注入失败');
    await route.fulfill({ response, body });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [name, width, height] of [['desktop',1920,1080],['ultrawide',3440,1440],['phone',390,844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin); await page.waitForSelector('#app[data-state="idle"]');
    const typography = await page.evaluate(() => {
      const copy = [...document.querySelectorAll('.description .seal-character, [data-entrance] .seal-character')];
      return { text: document.querySelector('.description').textContent.replace(/\s/g, ''), characters: copy.length,
        banks: document.querySelectorAll('.seal-glyph-bank').length,
        unresolved: [...document.querySelectorAll('use[href^="#seal-"]')].filter(el => !document.getElementById(el.getAttribute('href').slice(1))).length };
    });
    if (typography.banks !== 1 || typography.unresolved || typography.characters !== 50 ||
      typography.text !== '开发者·写作者·时空旅人写代码也写故事此间有故事，亦有远方把热爱写进代码，把故事交给月光')
      throw new Error(JSON.stringify({ name, typography }));
    const frames = [];
    for (const [stage, time] of [['idle',0],['left',2.04],['middle',2.24],['right',2.43],['finished',3]]) {
      const sample = await page.evaluate(({time}) => {
        const {chest,renderer,scene,camera,terrain} = window.__reflectionReview;
        chest.update(0, 0, false, time);
        const light = chest.box.getObjectByName('engraving-ground-light');
        const mask = new Map();
        // 遮住盒体本身的颜色贡献；草叶只保留真实投影，使像素差确实来自接收地面的反光。
        for (const root of [chest.box, terrain.group.getObjectByName('terrain-grass')]) root.traverse(object => {
          if (object.isMesh || object.isSprite) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!mask.has(material)) mask.set(material,{colorWrite:material.colorWrite,depthWrite:material.depthWrite});
            material.colorWrite = false;
            if (root !== chest.box) material.depthWrite = false;
          }
        });
        const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const off = new Uint8Array(w*h*4), on = new Uint8Array(off.length), visible = light.visible;
        light.visible = false; renderer.shadowMap.needsUpdate = true; renderer.render(scene,camera);
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,off);
        light.visible = visible; renderer.shadowMap.needsUpdate = true; renderer.render(scene,camera);
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,on);
        let pixels = 0, center = 0, peak = 0;
        for (let i=0;i<on.length;i+=4) {
          const red = on[i]-off[i], blue = on[i+2]-off[i+2];
          if(red>2 && red>blue) { pixels++; center+=(i/4)%w; }
          peak = Math.max(peak, red);
        }
        for(const [material,state] of mask) Object.assign(material,state);
        renderer.shadowMap.needsUpdate = true; renderer.render(scene,camera);
        const result = { intensity:light.intensity, visible, localX:light.position.x,
          shadow:!!light.shadow.map, pixels, center:pixels?center/pixels:0, peak };
        window.__captureGlint = value => { chest.update(0,0,false,value); renderer.shadowMap.needsUpdate=true; renderer.render(scene,camera); };
        return result;
      }, { time });
      if ((stage==='idle'||stage==='finished') ? sample.intensity!==0||sample.pixels!==0||sample.visible : sample.pixels<20||!sample.shadow)
        throw new Error(JSON.stringify({name,stage,...sample}));
      await page.screenshot({path:`output/playwright/reflection-${name}-${stage}.png`});
      frames.push({stage,time,...sample});
    }
    if(Math.abs(frames[1].center-frames[3].center)<width*.025 || frames[1].localX<=frames[3].localX)
      throw new Error(`反光没有跟随字槽位置移动：${JSON.stringify({name,frames})}`);
    results.push({name,typography,frames});
  }
  await page.emulateMedia({reducedMotion:'no-preference'});
  if(errors.length) throw new Error(errors.join('\n'));
  return results;
}
