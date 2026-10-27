// 在独立检查页复用真实木盒和纹理；方向断言采用生产相机，近景截图补充表面细节。
async (page) => {
  const target = await page.context().newPage(), origin = new URL(page.url()).origin;
  try {
    await target.route("**/__engraving-review", (route) => route.fulfill({ contentType: "text/html",
      body: '<body style="margin:0;background:#080f20;color:#dfd2ae"><p id="label" style="position:absolute;left:20px">刻字表面检查</p></body>' }));
    await target.goto(`${origin}/__engraving-review`);
    await target.setViewportSize({ width: 1200, height: 500 });
    const result = await target.evaluate(async () => {
      const THREE = await import("/node_modules/.vite/deps/three.js");
      const { createChest } = await import("/src/scene/chest.ts");
      const { engravingPlacements, spellEngraving } = await import("/src/scene/chest-engraving.ts");
      const { sceneConfig } = await import("/src/config.ts");
      const chest = await createChest(), scene = new THREE.Scene();
      // 铰链使用受光的金属材质，不能以自发光伪装金色，也必须参与实体阴影。
      const hinge = chest.box.getObjectByName('hinge-pin'), gold = hinge?.material;
      if (!gold || gold.name !== 'hinge-gold' || gold.color.getHex() !== 0xd7a44a ||
          gold.metalness < .5 || gold.roughness < .2 || gold.roughness > .5 ||
          gold.emissive.getHex() !== 0 || !hinge.castShadow || !hinge.receiveShadow)
        throw new Error('铰链金色材质或阴影属性错误');
      scene.background = new THREE.Color(0x080f20);
      scene.add(chest.box, new THREE.HemisphereLight(0xdbe8ff, 0x60503a, 2));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-2, 8, 7); scene.add(light);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(1200, 500); renderer.setPixelRatio(1.5); document.body.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(35, 2.4, 0.1, 100);
      camera.position.set(-0.4, 3.5, 5); camera.lookAt(-0.3, 0.65, 0);
      const surfaces = {};
      chest.box.traverse((mesh) => {
        if (!mesh.isMesh || !Array.isArray(mesh.material)) return;
        mesh.material.forEach((material, index) => {
          if (["wood-name", "wood-return", "wood-spell"].includes(material.name)) surfaces[material.name] = { mesh, material, index };
        });
      });
      // 反求纹理矩阵后的 UV，再还原对应实体面坐标；禁止凭字符串顺序代替实际投影。
      function glyphPoint(surface, x, y, view) {
        const { mesh, material, index } = surface, map = material.map;
        map.updateMatrix();
        const uv = new THREE.Vector3(x / map.image.width, 1 - y / map.image.height, 1).applyMatrix3(map.matrix.clone().invert());
        const p = index === 4 ? new THREE.Vector3((uv.x - 0.5) * 3.86, (uv.y - 0.5) * 0.44, 0.0325)
          : new THREE.Vector3((uv.x - 0.5) * 3.86, 0.0275, (0.5 - uv.y) * 0.604);
        mesh.localToWorld(p); p.project(view);
        return { x: p.x, y: -p.y };
      }
      const checks = [];
      for (const name of ["desktop", "mobile"]) {
        const preset = sceneConfig.layout[name], view = new THREE.PerspectiveCamera(preset.fov, name === "desktop" ? 16/9 : 390/844, 0.1, 350);
        view.position.set(preset.cameraX, preset.height, preset.distance); view.lookAt(preset.cameraX, preset.targetY, 0); view.updateMatrixWorld();
        for (const [face, text, progress, x, size, spacing, transform] of [
          ["name", "回到未來", 0, 398, 154, 190, {}],
          ["spell", spellEngraving.text, 0, spellEngraving.x, spellEngraving.size, spellEngraving.spacing, {}],
          ["return", "時光倒流", 1, 398, 154, 190, { reverse: true, rotation: Math.PI }],
        ]) {
          chest.update(progress, 0, true);
          const surface = surfaces[`wood-${face}`], positions = [];
          for (const placement of engravingPlacements(text, x, 46, size, spacing, transform)) {
            const p = glyphPoint(surface, placement.x, placement.y, view), angle = placement.rotation;
            const right = glyphPoint(surface, placement.x + 20 * Math.cos(angle), placement.y + 20 * Math.sin(angle), view);
            const top = glyphPoint(surface, placement.x + 20 * Math.sin(angle), placement.y - 20 * Math.cos(angle), view);
            if (right.x <= p.x || top.y >= p.y) throw new Error(`${name}/${face}/${placement.character}: 字形倒置或镜像`);
            positions.push(p.x);
          }
          if (positions.some((x, i) => i > 0 && x <= positions[i - 1])) throw new Error(`${name}/${face}: 字序不是从左到右`);
          checks.push({ name, face, text, positions });
        }
      }
      const lid = surfaces["wood-spell"].mesh;
      // 验证真实像素遮罩：木面保持黑色，字槽有白色核心与有限灰阶柔边。
      for (const { material } of Object.values(surfaces)) {
        if (material.emissiveIntensity !== 0.25 || !material.emissiveMap)
          throw new Error(`${material.name}: 缺少字槽基础微光`);
        for (const texture of [material.bumpMap, material.emissiveMap]) {
          if (texture.rotation !== material.map.rotation || !texture.center.equals(material.map.center))
            throw new Error(`${material.name}: 颜色、槽深与发光旋转不一致`);
        }
        const image = material.emissiveMap.image;
        const pixels = image.getContext("2d").getImageData(0, 0, image.width, image.height).data;
        let lit = 0, soft = 0, core = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]) lit++;
          if (pixels[i] > 0 && pixels[i] < 220) soft++;
          if (pixels[i] >= 220) core++;
        }
        if (!soft || !core || lit / (pixels.length / 4) > 0.15 || pixels[0] !== 0)
          throw new Error(`${material.name}: 发光未局限在字槽附近`);
      }
      for (const progress of [0, 1]) {
        chest.update(progress, 0, true);
        const normal = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(lid.matrixWorld));
        if (progress === 0 ? normal.y < 0.99 : normal.y > -0.99) throw new Error("盖顶刻字没有随开盖从朝天翻到朝地");
      }
      // 检查页只控制独立预览，不向 MoonScene 增加任何生产控制入口。
      window.reviewChest = (progress, time = 0, reduced = true) => {
        // 竖直抬升时退远检查相机，完整容纳盖顶；生产相机与转轴不受影响。
        camera.position.set(-0.4, progress === 0.5 ? 5.8 : 3.5, (progress === 0.5 ? 9 : 5) + chest.box.position.z);
        camera.lookAt(-0.3, progress === 0.5 ? 1.1 : 0.65, chest.box.position.z);
        chest.update(progress, 0, reduced, time); renderer.render(scene, camera);
      };
      // 读取同一静态模型的真实 GPU 像素，证明光带确实掠过，且不会点亮整张木面。
      const gl = renderer.getContext(), pixels = () => {
        const buffer = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
        return buffer;
      };
      window.reviewChest(0);
      const baseline = pixels(), glints = [];
      for (const time of [2.0, 2.12, 2.24, 2.36, 2.48]) {
        window.reviewChest(0, time, false);
        const image = pixels(); let changed = 0, center = 0;
        for (let i = 0; i < image.length; i += 4) {
          if (Math.max(image[i] - baseline[i], image[i + 1] - baseline[i + 1], image[i + 2] - baseline[i + 2]) > 3) {
            changed++; center += (i / 4) % gl.drawingBufferWidth;
          }
        }
        if (!changed || changed / (image.length / 4) > 0.015) throw new Error(`扫光范围异常：${time}/${changed}`);
        glints.push({ time, changed, center: center / changed });
      }
      if (Math.abs(glints[0].center - glints.at(-1).center) < 50) throw new Error("扫光未沿文字移动");
      window.reviewChest(0, 2.24, true);
      if (pixels().some((value, i) => value !== baseline[i])) throw new Error("减少动态时扫光仍在变化");
      return { checks, glints, reducedMotionStable: true, goldenHinge: true };
    });
    for (const [stage, progress] of [["closed", 0], ["90", 0.5], ["180", 1]]) {
      await target.evaluate(({ stage, progress }) => { document.querySelector("#label").textContent = `${stage === "closed" ? "合拢" : stage + "°"} · 真实模型近景检查`; window.reviewChest(progress); }, { stage, progress });
      await target.screenshot({ path: `output/playwright/engraving-${stage}.png` });
    }
    // 连续帧使用同一生产 update 与材质；可导出动画检查短促扫过的视觉强度。
    for (let i = 0; i < 32; i++) {
      await target.evaluate((time) => window.reviewChest(0, time, false), 1.6 + i / 24);
      await target.screenshot({ path: `output/playwright/engraving-glint-${String(i).padStart(2, "0")}.png` });
    }
    return result;
  } finally { await target.close(); }
}
