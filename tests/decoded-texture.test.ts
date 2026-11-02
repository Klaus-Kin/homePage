import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Initialization } from "../src/scene/initialization.ts";
import { prepareDecodedTexture, loadLunarTexture } from "../src/scene/decoded-texture.ts";

// 位图上传忽略 WebGL 的翻转和预乘开关，预解码必须显式保留原纹理的方向与颜色语义。
test("decoded texture preserves upload orientation and disposes the bitmap once", async () => {
  const texture = new THREE.Texture({} as HTMLImageElement), init = new Initialization();
  let closes = 0;
  const bitmap = { close() { closes++; } } as ImageBitmap;
  await prepareDecodedTexture(texture, init, async (image, options) => {
    assert.equal(image, texture.image);
    assert.deepEqual(options, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
    return bitmap;
  });
  assert.equal(texture.image, bitmap);
  init.dispose(); init.dispose();
  assert.equal(closes, 1);
});

// 解码可能在离页后才完成；迟到位图必须关闭，并保持原纹理不被重新接管。
test("late bitmap is closed after cancellation without replacing the texture", async () => {
  const original = {} as HTMLImageElement, texture = new THREE.Texture(original), init = new Initialization();
  let finish!: (bitmap: ImageBitmap) => void, closes = 0;
  const preparing = prepareDecodedTexture(texture, init, () => new Promise(resolve => { finish = resolve; }));
  init.dispose();
  await assert.rejects(preparing, { name: "AbortError" });
  finish({ close() { closes++; } } as ImageBitmap);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(texture.image, original); assert.equal(closes, 1);
});

// 不支持位图预解码或解码失败时仍上传原图，不把可选优化变成新的场景失败点。
test("unsupported and rejected bitmap preparation retain the original image", async () => {
  const original = {} as HTMLImageElement, texture = new THREE.Texture(original), init = new Initialization();
  await prepareDecodedTexture(texture, init, undefined);
  assert.equal(texture.image, original);
  await assert.rejects(prepareDecodedTexture(texture, init, async () => { throw new Error("decode failed"); }), /decode failed/);
  assert.equal(texture.image, original);
  init.dispose();
});

// Blob 路径不读取 HTMLImageElement 像素；显式源与不翻转纹理也必须保留原来的采样方向。
test("raw blob preparation uses the supplied source and non-flipped upload settings", async () => {
  const texture = new THREE.Texture(), init = new Initialization(), blob = new Blob(["pixels"]);
  texture.flipY = false; texture.premultiplyAlpha = true;
  await prepareDecodedTexture(texture, init, async (source, options) => {
    assert.equal(source, blob);
    assert.deepEqual(options, { imageOrientation: "none", premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
    return { close() {} } as ImageBitmap;
  }, blob);
  init.dispose();
});

// 真实加载入口必须请求原 URL、绑定取消信号，并把 Blob 直接交给位图解码，禁止先读 DOM 图片像素。
test("lunar loading decodes its fetched blob and preserves cancellation ownership", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  t.after(() => { if (previous) Object.defineProperty(globalThis, "createImageBitmap", previous); else delete (globalThis as any).createImageBitmap; });
  const init = new Initialization();
  let closes = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/assets/moon-lroc.jpg"); assert.equal(options?.signal, init.controller.signal);
    return new Response(new Blob(["original pixels"]));
  });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async (source: Blob) => {
    assert.ok(source instanceof Blob); assert.equal(await source.text(), "original pixels");
    return { close() { closes++; } };
  } });
  const texture = await loadLunarTexture("/assets/moon-lroc.jpg", init);
  assert.equal(typeof texture.image.close, "function");
  init.dispose(); assert.equal(closes, 1);
});

// HTTP 失败要快速进入既有启动降级，不能再次下载同一资源或静默展示白色占位月球。
test("lunar HTTP failures retain context and never start decoding", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  t.after(() => { if (previous) Object.defineProperty(globalThis, "createImageBitmap", previous); else delete (globalThis as any).createImageBitmap; });
  let requests = 0, decodes = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return new Response("missing", { status: 503 }); });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => { decodes++; } });
  const init = new Initialization();
  await assert.rejects(loadLunarTexture("/assets/moon-lroc.jpg", init), /503.*moon-lroc\.jpg/);
  assert.equal(requests, 1); assert.equal(decodes, 0); init.dispose();
});
