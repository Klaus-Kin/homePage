import * as THREE from "three";
import { EntryMotion } from "./entry-motion.ts";
import { createCrown, createMonkey, disposeModel } from "./entry-models.ts";
import type { EntryModel } from "./entry-models.ts";

/** 两个透明画布共用一个按需 RAF；交互文本独立于 WebGL，失败时仍可使用静态入口。 */
export function installEntryIcons(links: HTMLAnchorElement[]) {
  const events=new AbortController();
  const motionQuery=matchMedia("(prefers-reduced-motion: reduce)");
  const contrastQuery=matchMedia("(forced-colors: active)");
  let disposed=false, raf=0, previous: number | undefined;
  const items=links.map(link=>({
    link,slot:link.querySelector<HTMLElement>(".entry-icon")!,copy:link.querySelector<HTMLElement>(".entry-copy")!,
    motion:new EntryMotion(),hover:false,focus:false,dirty:true,frames:0,
    renderer:undefined as THREE.WebGLRenderer | undefined,
    scene:undefined as THREE.Scene | undefined,
    camera:undefined as THREE.OrthographicCamera | undefined,
    model:undefined as EntryModel | undefined,
  }));
  type Item=typeof items[number];

  function release(item: Item) {
    delete item.slot.dataset.modelReady;
    if(item.model) disposeModel(item.model.root);
    item.model=undefined;
    if(item.renderer) {
      item.renderer.domElement.remove();
      item.renderer.dispose();
      item.renderer.forceContextLoss();
    }
    item.renderer=undefined;
    item.scene=undefined;
    item.camera=undefined;
  }
  function wake() {
    if(disposed || document.hidden || raf) return;
    raf=requestAnimationFrame(tick);
  }
  function activate(item: Item) {
    const active=(item.hover || item.focus) && item.link.getAttribute("aria-disabled")!=="true";
    item.motion.setActive(active);
    item.dirty=true;
    wake();
  }
  function resize(item: Item) {
    if(!item.renderer) return;
    // 四周额外留 30% 透明区，固定占位仍是 44/36/30px；羽梢不会被画布裁切。
    const size=item.slot.getBoundingClientRect().width;
    item.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
    item.renderer.setSize(size*1.6,size*1.6,false);
    item.dirty=true;
  }
  function create(item: Item) {
    try {
      const canvas=document.createElement("canvas");
      canvas.className="entry-canvas";
      canvas.setAttribute("aria-hidden","true");
      // 构造失败时保留原图；构造成功后立即纳入生命周期，后续任一步失败也可完整清理。
      const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:"low-power"});
      item.renderer=renderer;
      renderer.setClearColor(0,0);
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure=1.15;
      item.scene=new THREE.Scene();
      item.camera=new THREE.OrthographicCamera(-51.2,51.2,51.2,-51.2,.1,300);
      item.camera.position.set(0,0,100);
      item.model=item.link.dataset.entrance==="world"?createMonkey():createCrown();
      item.scene.add(item.model.root,new THREE.HemisphereLight(0xd9e3ff,0x332516,2));
      const key=new THREE.DirectionalLight(0xffe4b1,4);
      key.position.set(-25,40,60);
      const fill=new THREE.DirectionalLight(0xa2b6db,1.7);
      fill.position.set(35,5,30);
      item.scene.add(key,fill);
      canvas.addEventListener("webglcontextlost",event=>{
        event.preventDefault();
        // 上下文失效立即恢复静态图；不自动创建新上下文，避免故障时反复占用 GPU。
        release(item);
        item.dirty=true;
        wake();
      },{signal:events.signal});
      item.slot.append(canvas);
      resize(item);
    } catch(error) {
      release(item);
      console.warn("入口立体图标不可用，已保留静态图标：",error);
    }
  }

  function tick(now: number) {
    raf=0;
    if(disposed || document.hidden) {previous=undefined;return;}
    const delta=previous===undefined?0:Math.max(0,now-previous);
    previous=now;
    for(const item of items) {
      const {motion}=item;
      const needsFrame=item.dirty || motion.running;
      if(!needsFrame) continue;
      motion.advance(delta);
      const phase=motion.time/1000*Math.PI*2;
      const amount=motion.reduced?0:motion.amount;
      // 中英文只有一个父容器承载位移，外层 choice-motion 的宝盒提示不受影响。
      const world=item.link.dataset.entrance==="world";
      const offset=world?1.5*(1-Math.cos(phase/1.8))*amount:2*Math.sin(phase/2.8)*amount;
      item.copy.style.transform=amount>0?`translate${world?"X":"Y"}(${offset}px)`:"none";
      item.link.dataset.entryActive=String(motion.active);
      if(item.renderer && item.scene && item.camera && item.model && !contrastQuery.matches) {
        try {
          item.model.update(motion.time,amount,motion.eye,motion.silk);
          item.renderer.render(item.scene,item.camera);
          // 首帧成功提交后才隐藏后备图；布局始终由固定占位和原图决定。
          item.slot.dataset.modelReady="true";
          item.slot.dataset.frames=String(++item.frames);
        } catch(error) {
          release(item);
          console.warn("入口立体图标绘制失败，已恢复静态图标：",error);
        }
      }
      item.dirty=false;
    }
    if(items.some(item=>item.motion.running)) wake();
    else previous=undefined;
  }

  for(const item of items) {
    item.motion.reduced=motionQuery.matches;
    item.link.classList.add("entry-enhanced");
    item.hover=item.link.matches(":hover");
    item.focus=item.link.matches(":focus-visible");
    item.link.addEventListener("pointerenter",event=>{
      if(event.pointerType!=="mouse" && event.pointerType!=="pen") return;
      item.hover=true;activate(item);
    },{signal:events.signal});
    item.link.addEventListener("pointerleave",()=>{item.hover=false;activate(item);},{signal:events.signal});
    item.link.addEventListener("pointercancel",()=>{item.hover=false;activate(item);},{signal:events.signal});
    item.link.addEventListener("focus",()=>{item.focus=item.link.matches(":focus-visible");activate(item);},{signal:events.signal});
    item.link.addEventListener("blur",()=>{item.focus=false;activate(item);},{signal:events.signal});
    create(item);
    activate(item);
  }
  const resizeObserver=new ResizeObserver(()=>{items.forEach(resize);wake();});
  items.forEach(item=>resizeObserver.observe(item.slot));
  const attributes=new MutationObserver(()=>items.forEach(activate));
  items.forEach(item=>attributes.observe(item.link,{attributes:true,attributeFilter:["aria-disabled"]}));
  const preferences=()=>{
    items.forEach(item=>{item.motion.reduced=motionQuery.matches;item.dirty=true;});
    wake();
  };
  motionQuery.addEventListener("change",preferences,{signal:events.signal});
  contrastQuery.addEventListener("change",preferences,{signal:events.signal});
  window.addEventListener("resize",()=>{items.forEach(resize);wake();},{signal:events.signal,passive:true});
  document.addEventListener("visibilitychange",()=>{
    cancelAnimationFrame(raf);raf=0;previous=undefined;
    if(!document.hidden) {items.forEach(item=>{item.dirty=true;});wake();}
  },{signal:events.signal});
  wake();
  return () => {
    disposed=true;
    events.abort();
    resizeObserver.disconnect();attributes.disconnect();
    cancelAnimationFrame(raf);
    items.forEach(item=>{
      release(item);
      item.link.classList.remove("entry-enhanced");
      delete item.link.dataset.entryActive;
      item.copy.style.removeProperty("transform");
    });
  };
}
