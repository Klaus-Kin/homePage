// 通过 playwright-cli run-code --filename 调用；检查无花草坡、中央留白、循环纹理与真实阴影。
async (page) => {
  const errors = [], results = [];
  const origin = new URL(page.url()).origin;
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/scene\.ts(?:\?|$)/, async route => {
    const response = await route.fetch(), source = await response.text();
    const body = source.replace('const firstSubmit = performance.now();',
      'window.__vegetationReview = { terrain, renderer, camera, scene, moonLight, chest, motionBounds }; const firstSubmit = performance.now();');
    if (body === source) throw new Error('场景注入失败');
    await route.fulfill({response,body});
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin);
  await page.waitForSelector('#app[data-state="idle"]');
  for (const [name,width,height] of [['ultrawide',3440,1440],['wide',2560,1080],['desktop',1440,900],['mobile',393,852],['desktop-restored',1440,900]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(500);
    const result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const {overlapsChestScenery,obstacleFootprint,grassReach,isCenterMeadowRock} = await import('/src/scene/terrain-clearance.ts');
      const {terrain,renderer,camera,scene,moonLight,chest,motionBounds} = window.__vegetationReview;
      const placement = { x: chest.box.position.x, z: chest.box.position.z, scale: chest.box.scale.x };
      const grass = terrain.group.getObjectByName('terrain-grass');
      const rocks = terrain.group.getObjectByName('terrain-rocks');
      let flowers=0, centralRocks=0;
      terrain.group.traverse(object=>{if(object.name.startsWith('flower-')||object.name==='terrain-flowers')flowers++;});
      const ground=terrain.group.getObjectByName('terrain-ground'), image=ground.material.map.image;
      const tile=image.getContext('2d').getImageData(0,0,256,256).data;
      let textureEdgeDifference=0;
      for(let i=0;i<256;i++) for(let channel=0;channel<3;channel++) {
        textureEdgeDifference=Math.max(textureEdgeDifference,
          Math.abs(tile[(i*256)*4+channel]-tile[(i*256+255)*4+channel]),
          Math.abs(tile[i*4+channel]-tile[(255*256+i)*4+channel]));
      }
      const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
      let clearanceViolations = 0, visibleGrassOutsideShadow = 0, openingBoundsOutsideShadow = 0;
      const lightPoint = new THREE.Vector3(), viewPoint = new THREE.Vector3();
      for (const mesh of [grass,rocks]) for(let i=0;i<mesh.count;i++) {
        mesh.getMatrixAt(i,matrix); matrix.decompose(p,q,s);
        let radius;
        if(mesh === grass) radius=grassReach(s.x,new THREE.Euler().setFromQuaternion(q).z);
        else radius=Math.max(...obstacleFootprint(mesh.geometry.attributes.position.array,matrix.elements).map(v=>Math.hypot(v.x-p.x,v.z-p.z)));
        if(mesh===rocks && isCenterMeadowRock(p.x,p.z))centralRocks++;
        if(overlapsChestScenery(p.x,p.z,radius,placement)) clearanceViolations++;
        if(mesh===grass) {
          viewPoint.copy(p).project(camera);
          lightPoint.copy(p).project(moonLight.shadow.camera);
          if(Math.abs(viewPoint.x)<1 && Math.abs(viewPoint.y)<1 && Math.abs(viewPoint.z)<1 &&
            Math.max(Math.abs(lightPoint.x),Math.abs(lightPoint.y),Math.abs(lightPoint.z))>1)
            visibleGrassOutsideShadow++;
        }
      }
      // 同时检查完整开盖包围体，防止宽屏修复以牺牲立盖和展开落点的阴影为代价。
      for(const x of [motionBounds.min.x,motionBounds.max.x]) for(const y of [motionBounds.min.y,motionBounds.max.y])
        for(const z of [motionBounds.min.z,motionBounds.max.z]) {
          lightPoint.set(x,y,z).applyMatrix4(chest.box.matrixWorld).project(moonLight.shadow.camera);
          if(Math.max(Math.abs(lightPoint.x),Math.abs(lightPoint.y),Math.abs(lightPoint.z))>1)
            openingBoundsOutsideShadow++;
        }
      // 同一个冻结场景只切换草的投影，读回像素差验证地面确实出现了草影。
      const gl=renderer.getContext(), width=gl.drawingBufferWidth, height=gl.drawingBufferHeight;
      const before=new Uint8Array(width*height*4), after=new Uint8Array(before.length);
      grass.material.colorWrite=false; grass.material.depthWrite=false;
      grass.castShadow=false; renderer.shadowMap.needsUpdate=true; renderer.render(scene,camera);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,before);
      grass.castShadow=true; renderer.shadowMap.needsUpdate=true; renderer.render(scene,camera);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,after);
      let shadowPixels=0, leftShadowPixels=0, maximumDarkening=0;
      for(let i=0;i<before.length;i+=4) {
        const change=before[i]+before[i+1]+before[i+2]-after[i]-after[i+1]-after[i+2];
        if(change>5) {
          shadowPixels++;
          if((i/4)%width < width*0.25) leftShadowPixels++;
        }
        maximumDarkening=Math.max(maximumDarkening,change);
      }
      grass.material.colorWrite=true; grass.material.depthWrite=true;
      // 隐藏盒体的颜色和深度写入但保留它的投影；同一真实场景比较原先与加深后的盒影。
      const materials=new Map();
      chest.box.traverse(object=>{
        if(object.isMesh||object.isSprite) for(const material of Array.isArray(object.material)?object.material:[object.material]) {
          if(!materials.has(material))materials.set(material,{colorWrite:material.colorWrite,depthWrite:material.depthWrite});
          material.colorWrite=false;material.depthWrite=false;
        }
      });
      grass.castShadow=false;rocks.castShadow=false;
      const intensity=moonLight.shadow.intensity;
      moonLight.shadow.intensity=.72;renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,before);
      moonLight.shadow.intensity=intensity;renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,after);
      let chestShadowGainPixels=0;
      for(let i=0;i<before.length;i+=4)
        if(before[i]+before[i+1]+before[i+2]-after[i]-after[i+1]-after[i+2]>3)chestShadowGainPixels++;
      for(const [material,state] of materials)Object.assign(material,state);
      grass.castShadow=true;rocks.castShadow=true;
      renderer.shadowMap.needsUpdate=true; renderer.render(scene,camera);
      return {grass:grass.count,rocks:rocks.count,flowers,centralRocks,textureEdgeDifference,
        visibleGrassOutsideShadow,openingBoundsOutsideShadow,chestShadowGainPixels,
        clearanceViolations,shadowPixels,leftShadowPixels,maximumDarkening,
        fallback:document.querySelector('#app').classList.contains('fallback')};
    });
    if(result.fallback || result.clearanceViolations || result.visibleGrassOutsideShadow || result.openingBoundsOutsideShadow ||
      result.shadowPixels<30 || (width>=1440 && result.leftShadowPixels<30) || result.flowers || result.centralRocks ||
      result.textureEdgeDifference || result.chestShadowGainPixels<30)
      throw new Error(JSON.stringify({name,...result}));
    await page.screenshot({path:`output/playwright/vegetation-${name}.png`});
    results.push({name,width,height,...result});
  }
  if(errors.length) throw new Error(errors.join('\n'));
  return {results,errors};
}
