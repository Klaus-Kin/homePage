import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceFrame, choiceGroundOffset, choiceLightPoint, choiceLineFrame, CHOICE_LINES, CHOICE_TRAIL_MS, CHOICE_DURATION, PROMPT_DURATION, choiceKeyframes } from "../src/choice-prompt.ts";
import { Vector3, Euler } from "three";

// 真实绝对时间锁定四段动作；绕行完成后才下拉，盖子接触之后才开始冲击。
test("prompt retains the original lid orbit clock, closing impact and duration", () => {
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

// 三路独立时间只作用于金线；按真实画面中、左、右依次出现，各自完成完整两圈。
test("three gold lines launch center left right and finish two forward turns before returning", () => {
  assert.deepEqual(CHOICE_LINES.map(line => [line.side, line.start]), [["center", 300], ["left", 360], ["right", 420]]);
  assert.ok(CHOICE_LINES[1].x > CHOICE_LINES[0].x && CHOICE_LINES[0].x > CHOICE_LINES[2].x);
  for (const line of CHOICE_LINES) {
    assert.equal(choiceLineFrame(line.start, line).strength, 0);
    assert.ok(choiceLineFrame(line.start + 1, line).strength > 0);
    assert.equal(choiceLineFrame(1050, line).turn, 2);
    let previous = -1;
    for (let ms = line.start; ms <= 1350; ms++) {
      const f = choiceLineFrame(ms, line);
      assert.ok(f.distance >= previous, "返回不能倒放路径");
      previous = f.distance;
    }
    assert.equal(choiceLineFrame(1350, line).strength, 0);
    assert.equal(choiceLineFrame(800, line, true).strength, 0);
  }
});

// 从实际曲线坐标累计解缠角度，防止只把计数器写成两圈而几何路径仍只走一圈。
test("sampled geometry winds around the lid twice in back top front order and accelerates home", () => {
  for (const line of CHOICE_LINES) {
    let previous = 0, winding = 0;
    for (let step = 0; step <= 1000; step++) {
      const ms = line.start + 90 + (1050-line.start-90)*step/1000;
      const lid = choiceFrame(ms).lid, p = choiceLightPoint(ms,line,lid,{x:0,y:0,z:0});
      const y = (p.x-1.93)*Math.sin(lid)+(p.y-.61)*Math.cos(lid);
      const angle = Math.atan2(p.z,.305-y);
      if (step) {
        const delta = Math.atan2(Math.sin(angle-previous),Math.cos(angle-previous));
        assert.ok(delta >= -1e-10, "绕盖路径必须始终顺向");
        winding += delta;
      }
      previous = angle;
    }
    assert.ok(Math.abs(winding-4*Math.PI)<1e-8);
    const early = choiceLineFrame(1090,line).pull-choiceLineFrame(1070,line).pull;
    const late = choiceLineFrame(1230,line).pull-choiceLineFrame(1210,line).pull;
    assert.ok(late > early*3, "后半段返回必须有明显加速度");
  }
});

// 把整条拖尾连同粒子包络放进实际上下盒木板坐标，逐毫秒检查合盖时的几何净空。
test("all heads tails and particle envelopes clear both halves and finish at their cavity origins", () => {
  const point = {x:0,y:0,z:0};
  const boxDistance = (x:number,y:number,z:number,cx:number,cy:number,cz:number,hx:number,hy:number,hz:number) =>
    Math.hypot(Math.max(0,Math.abs(x-cx)-hx), Math.max(0,Math.abs(y-cy)-hy), Math.max(0,Math.abs(z-cz)-hz));
  for (const line of CHOICE_LINES) {
    const first = choiceLightPoint(line.start, line, choiceFrame(line.start).lid, {x:0,y:0,z:0});
    const last = choiceLightPoint(1350, line, 0, {x:0,y:0,z:0});
    assert.deepEqual(last, first);
    assert.equal(first.x, line.x);
    assert.ok(first.y > .2 && first.y < .5 && Math.abs(first.z) < .1);
    for (let ms = line.start; ms <= 1350; ms++) for (const age of [0,.25,.5,.75,1]) {
      const time = Math.max(line.start,ms-age*CHOICE_TRAIL_MS), lid = choiceFrame(ms).lid;
      choiceLightPoint(time,line,lid,point);
      const c=Math.cos(lid), s=Math.sin(lid), dx=point.x-1.93, dy=point.y-.61;
      const local = {x:dx*c-dy*s,y:dx*s+dy*c,z:point.z};
      // 包络在盒内起终点收束；其他时间包含原散粒的最大偏移及光头半径。
      const envelope = choiceLineFrame(time,line).spread * .14 + .012;
      for (const [p, upper] of [[point,false],[local,true]] as const) {
        const offset = upper ? -1.93 : 0;
        const walls = [
          [offset,.5775,0,1.93,.0325,.22],
          [offset,.308,-.1925,1.93,.302,.0275], [offset,.308,.1925,1.93,.302,.0275],
          [offset-1.8975,.308,0,.0325,.302,.165], [offset+1.8975,.308,0,.0325,.302,.165],
        ];
        const y = upper ? p.y : .61-p.y;
        for (const wall of walls) assert.ok(boxDistance(p.x,y,p.z,...wall as [number,number,number,number,number,number]) >= envelope-1e-8,
          `穿板: ${JSON.stringify({side:line.side,ms,age,point,local,envelope,wall,upper})}`);
      }
    }
    // 连续采样排除分段接缝跳点，结束前整条拖尾都已经回到相同内腔。
    let previous = {...first};
    for (let ms=line.start+1;ms<=1350;ms++) {
      choiceLightPoint(ms,line,choiceFrame(ms).lid,point);
      assert.ok(Math.hypot(point.x-previous.x,point.y-previous.y,point.z-previous.z)<.08);
      previous={...point};
    }
    assert.deepEqual(choiceLightPoint(1350-CHOICE_TRAIL_MS,line,0,{x:0,y:0,z:0}),first);
  }
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
