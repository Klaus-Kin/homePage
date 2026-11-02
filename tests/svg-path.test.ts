import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compactSvgPaths } from "../src/svg-path.ts";

// 紧邻数字可以依靠正负号或第二个小数点分隔；去掉这些分隔符会意外合并坐标。
test("SVG compaction keeps signed and adjacent decimal coordinates and packed arc flags", () => {
  assert.equal(compactSvgPaths('<path d="M0.000+1.000L1.000-0.000L.1.000"/>'),
    '<path d="M0+1L1-0L.1 0"/>');
  const arc = '<path d="M0 0A1 1 0 001.000 2.000"/>';
  assert.equal(compactSvgPaths(arc), arc);
});

// 用真实题词的所有路径核对数字序列；体积缩减不能改变任何笔画坐标、路径命令或 mask 属性。
test("SVG compaction preserves every numeric coordinate and path command", () => {
  const original = readFileSync(new URL("../src/assets/inscription.svg", import.meta.url), "utf8");
  const compact = compactSvgPaths(original);
  const paths = (svg: string) => [...svg.matchAll(/\sd="([^"]*)"/g)].map(match => match[1]);
  const before = paths(original), after = paths(compact);
  assert.equal(before.length, after.length); assert.ok(compact.length < original.length);
  const numbers = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
  before.forEach((path, index) => {
    assert.deepEqual([...path.matchAll(numbers)].map(match => Number(match[0])), [...after[index].matchAll(numbers)].map(match => Number(match[0])));
    assert.equal(path.replace(numbers, "#"), after[index].replace(numbers, "#"));
  });
  assert.equal(original.replace(/\sd="[^"]*"/g, ""), compact.replace(/\sd="[^"]*"/g, ""));
});
