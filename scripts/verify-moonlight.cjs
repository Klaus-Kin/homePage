// 通过 playwright-cli run-code --filename 调用；先检查生产页连续缩放，再用同一模型与灯光读取真实阴影像素。
async (page) => {
  // 验收显式开启详细采样，生产访问不再维护逐帧 DOM 数据。
  await page.context().addInitScript(() => { window.__moonDiagnostics = true; });
  const origin = new URL(page.url()).origin, layouts = [], errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await page.goto(origin);
    await page.waitForSelector('#app[data-state="idle"]');
    for (const [name, width, height] of [['desktop',1920,1080], ['laptop',1366,768],
      ['tablet',768,1024], ['mobile',390,844], ['small-mobile',360,800], ['short',844,390]]) {
      await page.setViewportSize({ width, height });
      // 不重新加载页面，等待 resize 真正提交，减少动态模式也必须重算光向与阴影。
      await page.waitForFunction(({width,height}) => {
        const canvas = document.querySelector('#scene canvas');
        return canvas && canvas.clientWidth === width && canvas.clientHeight === height;
      }, { width, height });
      await page.waitForTimeout(250);
      const sample = await page.locator('#scene').evaluate(el => ({
        lighting: JSON.parse(el.dataset.moonLighting), bounds: JSON.parse(el.dataset.boxBounds),
        quality: JSON.parse(el.dataset.resources), fallback: document.querySelector('#app').classList.contains('fallback'),
      }));
      if (sample.fallback) throw new Error(`${name}: 场景意外降级`);
      const { moon, light, target, direction } = sample.lighting;
      const delta = moon.map((v,i) => v - target[i]), length = Math.hypot(...delta);
      if (Math.hypot(...delta.map((v,i) => v / length - direction[i])) > 1e-8)
        throw new Error(`${name}: 月球与真实主光不共线`);
      if (Math.abs(Math.hypot(...light.map((v,i) => v - target[i])) - 30) > 1e-8)
        throw new Error(`${name}: 阴影光源未聚焦近景`);
      if (sample.bounds.left < 0 || sample.bounds.right > width || sample.bounds.bottom > height)
        throw new Error(`${name}: 宝盒被裁切`);
      await page.screenshot({path:`output/playwright/moon-after-${name}.png`});
      layouts.push({ name, width, height, ...sample });
    }
    const desktop = layouts[0].lighting.direction, mobile = layouts[3].lighting.direction;
    if (Math.hypot(...desktop.map((v,i) => v-mobile[i])) < 0.1) throw new Error('横竖屏光向未变化');

    const review = await page.context().newPage();
    try {
      await review.route('**/__moonlight-review', route => route.fulfill({contentType:'text/html',
        body:'<body style="margin:0;background:#fff"></body>'}));
      await review.goto(`${origin}/__moonlight-review`);
      await review.setViewportSize({width:1000,height:700});
      const shadows = await review.evaluate(async (layouts) => {
        const THREE = await import('/node_modules/.vite/deps/three.js');
        const { createChest } = await import('/src/scene/chest.ts');
        const { createMoonLight, syncMoonLight } = await import('/src/scene/moonlight.ts');
        const chest = await createChest(), scene = new THREE.Scene(), light = createMoonLight();
        scene.background = new THREE.Color('white');
        const renderer = new THREE.WebGLRenderer({antialias:true});
        renderer.setSize(1000,700); renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        light.shadow.mapSize.set(1024,1024);
        document.body.appendChild(renderer.domElement);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(30,30), new THREE.ShadowMaterial({opacity:1}));
        floor.rotation.x = -Math.PI/2; floor.receiveShadow = true;
        floor.position.z = chest.box.position.z;
        scene.add(chest.box, floor, light, light.target);
        const camera = new THREE.PerspectiveCamera(42,1000/700,.1,100);
        camera.position.set(3,6,chest.box.position.z+10);
        camera.lookAt(chest.box.position.x,0,chest.box.position.z+1);
        camera.updateMatrixWorld();
        // 只禁止盒体写颜色，保留它的深度与投影；白底上的黑色像素因此确实来自地面阴影。
        chest.box.traverse(object => {
          if (object.isMesh) for (const m of Array.isArray(object.material)?object.material:[object.material]) m.colorWrite=false;
          if (object.isSprite || object.isLight) object.visible=false;
        });
        const moon = new THREE.Object3D(), target = new THREE.Vector3(...layouts[0].lighting.target);
        const gl = renderer.getContext(), ray = new THREE.Raycaster();
        const plane = new THREE.Plane(new THREE.Vector3(0,1,0),0), point = new THREE.Vector3(), results=[];
        const draw = (layout) => {
          moon.position.fromArray(layout.lighting.moon); syncMoonLight(light,moon,target);
          renderer.render(scene,camera);
        };
        for (const layout of [layouts[0],layouts[3]]) {
          draw(layout);
          const pixels=new Uint8Array(1000*700*4);
          gl.readPixels(0,0,1000,700,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          let count=0,x=0,z=0;
          for(let py=0;py<700;py+=2) for(let px=0;px<1000;px+=2) {
            if(pixels[(py*1000+px)*4]>160) continue;
            ray.setFromCamera(new THREE.Vector2((px+.5)/500-1,(py+.5)/350-1),camera);
            if(ray.ray.intersectPlane(plane,point)) {count++;x+=point.x;z+=point.z;}
          }
          const center=[x/count,z/count], d=layout.lighting.direction;
          const away=(center[0]-target.x)*-d[0]+(center[1]-target.z)*-d[2];
          if(count<100 || !Number.isFinite(away) || away<.4)
            throw new Error(`${layout.name}: 实际地面阴影方向异常 ${JSON.stringify({count,center,away})}`);
          results.push({name:layout.name,count,center,away});
        }
        if(Math.hypot(...results[0].center.map((v,i)=>v-results[1].center[i]))<.2)
          throw new Error('分辨率改变后真实 GPU 阴影没有改变');
        // 截图保留真实月光和生产材质，可独立查看背月暗面与接地投影。
        chest.box.traverse(object => {
          if(object.isMesh) for(const m of Array.isArray(object.material)?object.material:[object.material]) m.colorWrite=true;
          if(object.isSprite || object.isLight) object.visible=true;
        });
        floor.material = new THREE.MeshStandardMaterial({color:0x505746,roughness:1});
        scene.background.set(0x111c2b);
        scene.add(new THREE.HemisphereLight(0x9ebde8,0x292719,1.1));
        const fill=new THREE.PointLight(0xcbd6dd,2,7,2);
        fill.position.set(chest.box.position.x-1.35,2.3,chest.box.position.z-.25);scene.add(fill);
        renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
        window.reviewMoonlight = (index) => draw(layouts[index]);
        window.reviewMoonlight(0);
        return results;
      }, layouts);
      for(const [name,index] of [['desktop',0],['mobile',3]]) {
        await review.evaluate(index=>window.reviewMoonlight(index),index);
        await review.screenshot({path:`output/playwright/moon-shadow-${name}.png`});
      }
      if(errors.length) throw new Error(errors.join('\n'));
      return { layouts, shadows, errors };
    } finally { await review.close(); }
  } finally {
    page.off('pageerror',onError);
    await page.emulateMedia({reducedMotion:'no-preference'});
  }
}
