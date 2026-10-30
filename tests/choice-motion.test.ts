import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceFrame, choiceGroundOffset, choiceLightPoint, CHOICE_DURATION, PROMPT_DURATION, choiceKeyframes } from "../src/choice-prompt.ts";
import { Vector3, Euler } from "three";

// 真实绝对时间锁定四段动作；绕行完成后才下拉，盖子接触之后才开始冲击。
test("prompt opens to 26 degrees, completes one orbit, closes before impact and ends at rest", () => {
  assert.equal(PROMPT_DURATION, 1800);
  assert.equal(choiceFrame(0).lid, 0);
  assert.equal(choiceFrame(300).lid, 26 * Math.PI / 180);
  assert.equal(choiceFrame(1050).orbit, 1);
  assert.equal(choiceFrame(1050).pull, 0);
  assert.ok(choiceFrame(1200).lid > 0);
  assert.equal(choiceFrame(1350).lid, 0);
  assert.equal(choiceFrame(1350).light, 0);
  assert.ok(Math.abs(choiceFrame(1410).roll) > 0);
  for (const ms of [-1, 0, 1800, 2000]) {
    const frame = choiceFrame(ms);
    assert.deepEqual([frame.lid, frame.yaw, frame.roll, frame.pitch, frame.lift, frame.light], [0, 0, 0, 0, 0, 0]);
  }
});

// 整圈与收紧末端均留出大于光带半径的实体净空，起终点在远离铰链的分离端附近重合。
test("gold orbit completes a closed loop outside all four lid corners even while tightening", () => {
  const point={x:0,y:0,z:0};
  for (let pull=0;pull<=1;pull+=.02) for (let step=0;step<=720;step++) {
    choiceLightPoint(step/720,pull,point);
    assert.ok(point.x< -3.5 && point.x> -3.86);
    assert.ok(point.y < -.012 || point.y > .622 || Math.abs(point.z) > .232,
      `光带穿过上盖: ${JSON.stringify({pull,step,point})}`);
  }
  const first=choiceLightPoint(0,0,{x:0,y:0,z:0}),last=choiceLightPoint(1,0,{x:0,y:0,z:0});
  assert.ok(Math.abs(first.x-last.x)<1e-8 && Math.abs(first.y-last.y)<1e-8 && Math.abs(first.z-last.z)<1e-8);
  assert.ok(first.y<0 && first.x< -3.5);
});

// 毫秒级采样约束振幅和先后关系；额外离地高度与支撑补偿分别计算。
test("prompt motion stays bounded and reduced or cancelled samples restore the exact baseline", () => {
  let peakYaw = 0, peakRoll = 0, peakLift = 0;
  for (let ms = 0; ms <= PROMPT_DURATION; ms++) {
    const f = choiceFrame(ms);
    assert.ok(f.lid >= 0 && f.lid <= 26 * Math.PI / 180);
    assert.ok(Math.abs(f.yaw) <= 4 * Math.PI / 180);
    assert.ok(Math.abs(f.roll) <= 2 * Math.PI / 180);
    assert.ok(f.lift >= 0 && f.lift <= 1.22 * .04);
    assert.ok(f.orbit >= 0 && f.orbit <= 1 && f.pull >= 0 && f.pull <= 1);
    if (ms < 1350) assert.equal(f.lift, 0);
    if (ms >= 1350) assert.equal(f.light, 0);
    const reduced = choiceFrame(ms, true);
    assert.deepEqual([reduced.lid, reduced.yaw, reduced.roll, reduced.pitch, reduced.lift, reduced.light], [0, 0, 0, 0, 0, 0]);
    peakYaw = Math.max(peakYaw, Math.abs(f.yaw));
    peakRoll = Math.max(peakRoll, Math.abs(f.roll));
    peakLift = Math.max(peakLift, f.lift);
  }
  assert.ok(peakYaw > 2 * Math.PI / 180 && peakRoll > Math.PI / 180 && peakLift > .02);
});

// 延长提示门禁不能拉长文字抖动；旧的七个绝对时间点与位移逐项保持。
test("text retains its original 720ms absolute keyframes then holds still until the chest finishes", () => {
  const frames = choiceKeyframes(false, PROMPT_DURATION);
  assert.deepEqual(frames.slice(0, 7).map(f => Math.round(Number(f.offset) * PROMPT_DURATION)), [0, 80, 160, 320, 480, 640, 720]);
  assert.deepEqual(frames.slice(0, 7).map(f => f.transform), choiceKeyframes(false).map(f => f.transform));
  assert.equal(CHOICE_DURATION, 720);
  assert.equal(frames.at(-1)!.offset, 1);
  assert.equal(frames.at(-1)!.transform, "translateX(0px)");
});

// 使用实际欧拉变换验证四个底角，最低点始终恰好等于允许的弹起高度而不会穿地。
test("ground compensation supports the real bottom corners through every impact sample", () => {
  for (let ms = 0; ms <= PROMPT_DURATION; ms++) {
    const f = choiceFrame(ms), yaw = Math.PI + f.yaw;
    const support = choiceGroundOffset(f.pitch, yaw, f.roll);
    const ys = [-1.93, 1.93].flatMap(x => [-.22, .22].map(z =>
      new Vector3(x, 0, z).applyEuler(new Euler(f.pitch, yaw, f.roll)).y + support + f.lift));
    assert.ok(Math.min(...ys) >= -1e-12);
    assert.ok(Math.abs(Math.min(...ys) - f.lift) < 1e-12);
  }
});
