// 记录当前构图的草坡与左缘，并临时靠近完整花株检查茎叶；所有取景和灯光在结束时恢复。
async (page) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:1440,height:900});
  await page.waitForTimeout(250);
  const restore=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const review=window.__vegetationReview ?? window.__meadowReview;
    const {terrain,camera,scene,renderer}=review;
    window.__detailReview=review;
    const restore={position:camera.position.toArray(),quaternion:camera.quaternion.toArray()};
    const flower=terrain.group.getObjectByName('terrain-flowers'),matrix=new THREE.Matrix4();
    const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
    let chosen=0,best=Infinity;
    for(let i=0;i<flower.count;i++){
      flower.getMatrixAt(i,matrix);matrix.decompose(p,q,s);
      const distance=Math.hypot(p.x+1,p.z-8);
      if(distance<best){best=distance;chosen=i;}
    }
    flower.getMatrixAt(chosen,matrix);matrix.decompose(p,q,s);
    camera.position.set(p.x+.8*s.y,p.y+.68*s.y,p.z+.95*s.y);
    camera.lookAt(p.x,p.y+.32*s.y,p.z);camera.updateMatrixWorld();
    // 地形材质使用观察空间中的固定月光方向，临时取景时同步该向量，避免检视改变实际受光。
    const materials=new Set();terrain.group.traverse(o=>{if(o.isMesh)
      for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
    window.__detailLightSync=()=>{for(const material of materials){
      const shader={uniforms:{},vertexShader:'',fragmentShader:''};material.onBeforeCompile(shader,renderer);
      shader.uniforms.uLandscapeLightDirection?.value.set(8,14,-6).normalize().transformDirection(camera.matrixWorldInverse);
    }};
    window.__detailLightSync();renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
    return restore;
  });
  const style=await page.addStyleTag({content:'.fade-content,#box-button{visibility:hidden!important}'});
  try {await page.locator('#scene canvas').screenshot({path:'output/playwright/lawn-flower-closeup.png'});}
  finally {
    await style.evaluate(el=>el.remove());
    await page.evaluate(restore=>{
      const {camera,renderer,scene}=window.__detailReview;
      camera.position.fromArray(restore.position);camera.quaternion.fromArray(restore.quaternion);camera.updateMatrixWorld();
      window.__detailLightSync();renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
      delete window.__detailLightSync;delete window.__detailReview;
    },restore);
  }
  await page.screenshot({path:'output/playwright/lawn-night-desktop.png'});
  await page.screenshot({path:'output/playwright/lawn-grass-closeup.png',clip:{x:220,y:650,width:700,height:250}});
  await page.screenshot({path:'output/playwright/lawn-left-edge.png',clip:{x:0,y:675,width:300,height:225}});
  return {flowerCloseup:true,grassCloseup:true,leftEdge:true,cameraRestored:true};
}
