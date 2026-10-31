// 按用户截图尺寸及断点两侧检查左坡真实像素，不能用植被总数代替屏幕覆盖。
async (page) => {
  const origin = new URL(page.url()).origin, results = [], errors = [];
  await page.route(/\/src\/scene\.ts(?:\?|$)/, async route => {
    const response = await route.fetch(), source = await response.text();
    const body = source.replace('const firstSubmit = performance.now();',
      'window.__coverageReview={terrain,renderer,camera,scene}; const firstSubmit = performance.now();');
    if (body === source) throw new Error('覆盖验收注入失败');
    await route.fulfill({ response, body });
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin);
  await page.waitForSelector('#app[data-state="idle"]:not([inert])');
  for (const [width,height] of [[844,390],[1024,499],[1024,500],[767,600],[768,600],
    [1366,768],[1920,1080],[2560,1080],[3440,1440],[390,844],[844,390]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(250);
    const result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const {terrain,camera,renderer,scene} = window.__coverageReview;
      const ground = terrain.group.getObjectByName('terrain-ground');
      const plants = [];
      terrain.group.traverse(mesh => { if (mesh.userData.meadowKind) plants.push(mesh); });
      const ray = new THREE.Raycaster(), point = new THREE.Vector3(), matrix = new THREE.Matrix4();
      const bands = Array.from({length:4}, () => ({groundSamples:0,roots:0,visiblePixels:0,shadowPixels:0}));
      for (let band=0;band<4;band++) for (const v of [.9,.95,.99]) {
        ray.setFromCamera(new THREE.Vector2(-1+(band+.5)/8,1-v*2),camera);
        if (ray.intersectObject(ground).length) bands[band].groundSamples++;
      }
      for (const plant of plants) for (let i=0;i<plant.count;i++) {
        plant.getMatrixAt(i,matrix); point.setFromMatrixPosition(matrix).project(camera);
        if (point.y<-.7 && point.y>-1 && point.x>-1 && point.x<-.5 && Math.abs(point.z)<1)
          bands[Math.min(3,Math.floor((point.x+1)*8))].roots++;
      }
      const gl=renderer.getContext(), w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
      const a=new Uint8Array(w*h*4), b=new Uint8Array(a.length), c=new Uint8Array(a.length);
      const read=buffer=>{renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buffer);};
      read(a);
      for (const plant of plants) plant.material.colorWrite=plant.material.depthWrite=false;
      read(b);
      for (const plant of plants) plant.castShadow=false;
      read(c);
      for (let y=0;y<h*.15;y++) for (let x=0;x<w*.25;x++) {
        const i=(y*w+x)*4, band=Math.min(3,Math.floor(x/w*16));
        if (Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>5)
          bands[band].visiblePixels++;
        if (c[i]+c[i+1]+c[i+2]-b[i]-b[i+1]-b[i+2]>3) bands[band].shadowPixels++;
      }
      for (const plant of plants) {plant.material.colorWrite=plant.material.depthWrite=true;plant.castShadow=true;}
      read(a);
      return {bands,quality:document.querySelector('#scene').dataset.quality,
        counts:plants.map(mesh=>[mesh.name,mesh.count]),resources:{...renderer.info.memory},
        fallback:document.querySelector('#app').classList.contains('fallback')};
    });
    await page.screenshot({path:`output/playwright/grass-coverage-after-${width}x${height}.png`});
    if (result.fallback || result.bands.some(b=>b.groundSamples && (b.roots<3 || b.visiblePixels<8)))
      throw new Error(`左坡可见地面缺草 ${JSON.stringify({width,height,...result})}`);
    if (width>=height && result.bands.reduce((n,b)=>n+b.shadowPixels,0)<8)
      throw new Error(`左坡没有真实草影 ${JSON.stringify({width,height,...result})}`);
    results.push({width,height,...result});
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return {results,errors};
}
