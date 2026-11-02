import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateSurfacePixels, generateCloudPixels, generateRockPixels } from "../src/scene/texture-pixels.ts";
import { loadTexturePixels } from "../src/scene/texture-cache.ts";
import { Initialization } from "../src/scene/initialization.ts";

// 所有离线文件必须逐字节等于原算法，特别检查透明云和岩面 alpha 高度。
test("precomputed RGBA exactly matches the original fixed-seed pixel generators", async () => {
  for (const kind of ["ground", "rock", "mountain", "cloud", "weathered-rock"] as const) {
    const expected = kind === "cloud" ? await generateCloudPixels()
      : kind === "weathered-rock" ? await generateRockPixels() : await generateSurfacePixels(kind);
    const stored = await readFile(new URL(`../public/assets/texture-${kind}.rgba`, import.meta.url));
    assert.deepEqual(stored, Buffer.from(expected), `${kind} 像素发生改变`);
  }
});

// 资源缺失或截断仍交付完整场景；取消请求必须拒绝，不能转入耗时的同步回退。
test("pixel loader recovers missing and truncated files and propagates cancellation", async () => {
  const init = new Initialization();
  const expected = Buffer.from(await generateSurfacePixels("mountain"));
  const originalWarn = console.warn; console.warn = () => {};
  try {
    for (const response of [new Response(null, { status: 404 }), new Response(new Uint8Array(7))]) {
      const isolated = new Initialization();
      const actual = await loadTexturePixels("mountain", isolated, (async () => response) as typeof fetch);
      assert.deepEqual(Buffer.from(actual), expected);
      isolated.dispose();
    }
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    const pending = loadTexturePixels("cloud", init, (() => { requested(); return new Promise(() => {}); }) as typeof fetch);
    await started; init.dispose();
    await assert.rejects(pending, { name: "AbortError" });
  } finally { console.warn = originalWarn; init.dispose(); }
});

// 并行预取和实际消费者共用请求；取消后不能命中一个已经成功的旧像素缓存。
test("texture consumers share an in-flight request within one initialization", async () => {
  const init = new Initialization(); let calls = 0;
  const request = (async () => { calls++; return new Response(new Uint8Array(256 * 256 * 4)); }) as typeof fetch;
  const child = init.fork();
  const [a, b] = await Promise.all([loadTexturePixels("ground", init, request), loadTexturePixels("ground", child, request)]);
  assert.equal(calls, 1); assert.equal(a, b); init.dispose();
  assert.throws(() => loadTexturePixels("ground", init, request), { name: "AbortError" });
});

// 一个子任务退出不能中断其他消费者的共享下载，退出者也不能接收迟到结果。
test("cancelled texture consumer leaves the root request available to its sibling", async () => {
  const root = new Initialization(), a = root.fork(), b = root.fork();
  let resolve!: (response: Response) => void, calls = 0;
  const request = (() => { calls++; return new Promise<Response>(done => { resolve = done; }); }) as typeof fetch;
  const first = loadTexturePixels("ground", a, request), second = loadTexturePixels("ground", b, request);
  a.dispose(); await assert.rejects(first, { name: "AbortError" });
  resolve(new Response(new Uint8Array(256 * 256 * 4)));
  assert.equal((await second).byteLength, 256 * 256 * 4); assert.equal(calls, 1);
  root.dispose();
});
