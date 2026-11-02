import { test } from "node:test";
import assert from "node:assert/strict";
import { NavigationRecovery } from "../src/navigation-recovery.ts";

// 真实浏览器的停止加载会中止 NavigateEvent.signal；慢请求自身不应触发任何恢复。
function navigate(target: EventTarget, url: string) {
  const controller = new AbortController();
  target.dispatchEvent(Object.assign(new Event("navigate"), { destination: { url }, signal: controller.signal }));
  return controller;
}

// 恢复必须跨过浏览器当前取消任务；微任务内重载会被导航算法抑制。
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

test("only cancellation of the armed navigation recovers, once", async () => {
  const events = new EventTarget();
  let recovered = 0;
  const recovery = new NavigationRecovery(events, () => recovered++);
  recovery.watch("https://destination.test/");
  const pending = navigate(events, "https://destination.test/");
  await Promise.resolve();
  assert.equal(recovered, 0);
  pending.abort();
  assert.equal(recovered, 0);
  await nextTask();
  assert.equal(recovered, 1);
  pending.abort();
  assert.equal(recovered, 1);
  recovery.dispose();
});

// 用户输入了另一个地址时应让新导航继续，不能被旧请求的取消回调抢回主页。
test("replacement navigation invalidates cancellation recovery", async () => {
  const events = new EventTarget();
  let recovered = 0;
  const recovery = new NavigationRecovery(events, () => recovered++);
  recovery.watch("https://destination.test/");
  const pending = navigate(events, "https://destination.test/");
  pending.abort();
  navigate(events, "https://other.test/");
  await nextTask();
  assert.equal(recovered, 0);
  recovery.dispose();
});

// 离页后销毁监听，迟到取消与不支持 Navigation API 的浏览器都不得重载旧文档。
test("disposal and unrelated navigation cannot recover the homepage", async () => {
  const events = new EventTarget();
  let recovered = 0;
  const recovery = new NavigationRecovery(events, () => recovered++);
  recovery.watch("https://destination.test/");
  navigate(events, "https://unrelated.test/").abort();
  recovery.watch("https://destination.test/");
  const pending = navigate(events, "https://destination.test/");
  recovery.dispose(); recovery.dispose(); pending.abort();
  await nextTask();
  assert.equal(recovered, 0);
  const unsupported = new NavigationRecovery(undefined, () => recovered++);
  unsupported.watch("https://destination.test/"); unsupported.dispose();
  assert.equal(recovered, 0);
});
