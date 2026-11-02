import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fitCamera, sceneViewport } from "../src/responsive.ts";
import { sceneConfig } from "../src/config.ts";

// 回归画布重复重置：一次同时设置尺寸和 DPR，后续布局仍可调整相机但不能重新分配同尺寸缓冲。
test("camera layout allocates the drawing buffer once per actual size or DPR change", () => {
  const descriptors = ["window", "matchMedia"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const environment = { devicePixelRatio: 2 };
  Object.defineProperty(globalThis, "window", { configurable: true, value: environment });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
  try {
    const size = new THREE.Vector2(300, 150), allocations: number[][] = [];
    let ratio = 1;
    const renderer = { getSize(target: THREE.Vector2) { return target.copy(size); }, getPixelRatio() { return ratio; },
      setDrawingBufferSize(width: number, height: number, nextRatio: number) {
        size.set(width, height); ratio = nextRatio; allocations.push([width, height, nextRatio]);
      } } as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera(), host = { clientWidth: 1920, clientHeight: 1080 };
    // 创建上下文前的物理像素尺寸与取景提交必须采用同一上限，不能只修复 DPR=1 的桌面。
    assert.deepEqual(sceneViewport(host as HTMLElement), { width: 1920, height: 1080, mobile: false,
      pixelRatio: Math.min(2, sceneConfig.quality.desktop.pixelRatio) });
    fitCamera(camera, renderer, host as HTMLElement);
    fitCamera(camera, renderer, host as HTMLElement);
    assert.deepEqual(allocations, [[1920, 1080, Math.min(2, sceneConfig.quality.desktop.pixelRatio)]]);
    environment.devicePixelRatio = 1;
    fitCamera(camera, renderer, host as HTMLElement);
    host.clientWidth = 390; host.clientHeight = 844;
    const layout = fitCamera(camera, renderer, host as HTMLElement);
    assert.equal(allocations.length, 3);
    assert.deepEqual(allocations.at(-1), [390, 844, 1]);
    assert.equal(layout.mobile, true);
    assert.equal(camera.aspect, 390 / 844);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
