// 在本地 Vite 页面中复用真实宝盒几何与材质，独立渲染灯光差分及木板遮挡像素。
async (page) => {
  await page.waitForSelector('#app[data-state="idle"]:not([inert])');
  const metrics=await page.evaluate(async()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {createChest}=await import('/src/scene/chest.ts');
    const {choiceFrame,CHOICE_LINES}=await import('/src/choice-prompt.ts');
    const chest=await createChest(), scene=new THREE.Scene();
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1000,650); renderer.setPixelRatio(1);
    renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05;
    const camera=new THREE.PerspectiveCamera(35,1000/650,.01,50);
    camera.position.set(2.6,2.5,5); camera.lookAt(0,.75,0);
    chest.box.position.set(0,0,0); scene.add(chest.box);
    const ambient=new THREE.AmbientLight(0xb9cfff,.6); scene.add(ambient);
    const moon=new THREE.DirectionalLight(0xccdbff,1.3); moon.position.set(-3,5,3); scene.add(moon);
    const root=chest.box.getObjectByName('choice-light');
    const lights=root.children.filter(o=>o.isPointLight), strands=root.children.filter(o=>o.isGroup);
    const target=new THREE.WebGLRenderTarget(1000,650);
    function pixels(){
      renderer.setRenderTarget(target); renderer.render(scene,camera);
      const data=new Uint8Array(1000*650*4); renderer.readRenderTargetPixels(target,0,0,1000,650,data);
      renderer.setRenderTarget(null); return data;
    }
    function difference(before,after){
      let energy=0,count=0,x=0,y=0,clipped=0;
      for(let i=0;i<before.length;i+=4){
        const delta=Math.max(0,after[i]-before[i])+Math.max(0,after[i+1]-before[i+1])+Math.max(0,after[i+2]-before[i+2]);
        if(delta>6){const k=i/4;energy+=delta;count++;x+=(k%1000)*delta;y+=(649-Math.floor(k/1000))*delta;}
        if(after[i]>250 && after[i+1]>250 && after[i+2]>250) clipped++;
      }
      return {energy,count,centroid:[x/Math.max(1,energy),y/Math.max(1,energy)],clipped};
    }
    const frames=[];
    for(const ms of [470,560,650,850,1140,1220]){
      chest.update(0,0,false,0,choiceFrame(ms));
      // 关闭发光几何后只比较木面的灯光贡献，排除光头或拖尾像素冒充反光。
      strands.forEach(o=>o.visible=false);
      const intensities=lights.map(light=>light.intensity);
      lights.forEach(light=>light.intensity=0); const before=pixels();
      lights.forEach((light,i)=>light.intensity=intensities[i]); const after=pixels();
      const diff=difference(before,after);
      if(diff.clipped>100) throw new Error(`木面过曝 ${ms}: ${diff.clipped}`);
      frames.push({ms,...diff,heads:lights.map(light=>light.position.toArray())});
    }
    const bright=frames.filter(f=>f.count>30 && f.energy>500);
    if(bright.length<3 || Math.max(...bright.map(f=>Math.hypot(f.centroid[0]-bright[0].centroid[0],f.centroid[1]-bright[0].centroid[1])))<40)
      throw new Error(`木面亮斑没有随光头移动: ${JSON.stringify(frames)}`);
    // 保持灯光和木面相同，只切换发光几何，单独统计真正可见的拖影像素；闭合帧必须为零。
    const trailFrames=[];
    for(const ms of [560,650,850,1140,1220,1320,1350]){
      chest.update(0,0,false,0,choiceFrame(ms));
      const visibility=strands.map(o=>o.visible);
      strands.forEach(o=>o.visible=false);const before=pixels();
      strands.forEach((o,i)=>o.visible=visibility[i]);const after=pixels();
      trailFrames.push({ms,...difference(before,after)});
    }
    if(trailFrames.find(f=>f.ms===650).count<300 || trailFrames.at(-1).count!==0)
      throw new Error(`拖影不可见或闭合后残留: ${JSON.stringify(trailFrames)}`);
    // 确认画面中左/中/右起点和点光源位置，灯光必须始终与自己光头重合。
    const projected=CHOICE_LINES.map(line=>new THREE.Vector3(line.x,.36,0).applyMatrix4(chest.box.matrixWorld).project(camera).x);
    if(!(projected[1]<projected[0] && projected[0]<projected[2])) throw new Error('实际画面左右次序错误');
    for(const ms of [320,380,440,650,1200,1349,1350,1800]){
      chest.update(0,0,false,0,choiceFrame(ms));
      for(let i=0;i<strands.length;i++){
        const head=strands[i].getObjectByName('choice-head');
        if(lights[i].intensity>0 && lights[i].position.distanceTo(head.position)>1e-10) throw new Error('灯光未跟随光头');
      }
      if(ms>=1350 && (strands.some(o=>o.visible)||lights.some(light=>light.intensity!==0))) throw new Error('闭合后存在残留');
    }
    // 在真实下盒底板下放置接收面。木板只写阴影、不写颜色，让 GPU 读数直接观察被挡住的接收面。
    chest.update(0,0,false,0,choiceFrame(301));
    strands.forEach(o=>o.visible=false); ambient.intensity=moon.intensity=0;
    lights.forEach(light=>light.intensity=0);
    const source=lights[0];source.position.set(0,.36,0);source.intensity=.045;
    chest.box.traverse(object=>{
      if(object.isMesh) for(const material of Array.isArray(object.material)?object.material:[object.material]){
        material.colorWrite=false; material.depthWrite=false;
      }
    });
    const probe=new THREE.Mesh(new THREE.PlaneGeometry(.8,.2),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}));
    probe.rotation.x=-Math.PI/2;probe.position.y=-.04;probe.receiveShadow=true;chest.box.add(probe);
    const shadowed=pixels();
    source.castShadow=false;const leaking=pixels();
    let blockedEnergy=0,leakingEnergy=0,probePixels=0;
    for(let i=0;i<leaking.length;i+=4){
      const lit=leaking[i]+leaking[i+1]+leaking[i+2];
      if(lit>30){leakingEnergy+=lit;blockedEnergy+=shadowed[i]+shadowed[i+1]+shadowed[i+2];probePixels++;}
    }
    const ratio=blockedEnergy/Math.max(1,leakingEnergy);
    if(probePixels<100 || ratio>.03) throw new Error(`木板漏光: ${JSON.stringify({probePixels,ratio})}`);
    // 保存同一实际材质的近景，供肉眼检查木纹与暖金亮斑，随后由外层截图命令落盘。
    probe.visible=false; source.castShadow=true;ambient.intensity=.6;moon.intensity=1.3;
    chest.box.traverse(object=>{if(object.isMesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){
      material.colorWrite=true;material.depthWrite=true;
    }});
    const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#000';
    overlay.append(renderer.domElement);document.body.append(overlay);
    // 保留临时夹具只为后续截图，页面关闭时释放，不进入应用代码。
    window.__choiceRenderCapture=ms=>{chest.update(0,0,false,0,choiceFrame(ms));renderer.render(scene,camera);};
    window.__choiceRenderCapture(650);
    return {frames,trailFrames,projected,shadow:{probePixels,blockedEnergy,leakingEnergy,ratio},exposure:renderer.toneMappingExposure};
  });
  for(const ms of [470,560,650,850,1140,1220,1350]){
    await page.evaluate(ms=>window.__choiceRenderCapture(ms),ms);
    await page.screenshot({path:`output/playwright/gold-light-closeup-${ms}.png`});
  }
  return metrics;
}
