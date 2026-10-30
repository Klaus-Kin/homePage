import { test } from "node:test";
import assert from "node:assert/strict";
import { EntryMotion, featherPose, featherSection, silkPoint } from "../src/entry-motion.ts";

// 先约束持续激活与收尾边界，避免把一次性过渡误做成悬停循环。
test("entry stays active for long hover and settles in 450ms", () => {
  const motion = new EntryMotion();
  motion.setActive(true);
  motion.advance(300);
  assert.equal(motion.amount, 1);
  motion.advance(15000);
  assert.equal(motion.amount, 1);
  assert.equal(motion.eye, 1);
  assert.equal(motion.silk, 1);
  motion.setActive(false);
  motion.advance(225);
  assert.ok(motion.amount > 0 && motion.amount < 1);
  motion.advance(225);
  assert.equal(motion.amount, 0);
  assert.equal(motion.eye, 0);
  assert.equal(motion.silk, 0);
  assert.equal(motion.running, false);
});

// 重入只改变目标，不能重置当前姿态；两个入口的时间和强度也不能串联。
test("rapid reversals preserve current values and entries stay independent", () => {
  const crown = new EntryMotion(), monkey = new EntryMotion();
  crown.setActive(true); crown.advance(150);
  const before = crown.amount;
  crown.setActive(false);
  assert.equal(crown.amount, before);
  crown.advance(80);
  const fading = crown.amount;
  crown.setActive(true);
  assert.equal(crown.amount, fading);
  crown.advance(300);
  assert.equal(crown.amount, 1);
  assert.equal(monkey.amount, 0);
  monkey.setActive(true); monkey.advance(350);
  assert.equal(monkey.eye, 1);
  assert.equal(monkey.silk, 0);
  monkey.advance(400);
  assert.ok(Math.abs(monkey.silk - .5) < .001);
});

// 隐藏页面的调度器不调用 advance；减少动态最终必须停止循环并保留静态反馈。
test("reduced motion keeps short static silk and resumes without resetting time", () => {
  const motion = new EntryMotion();
  motion.setActive(true); motion.advance(1500);
  const time = motion.time;
  motion.reduced = true;
  assert.equal(motion.running, false);
  assert.equal(motion.eye, 1);
  assert.ok(motion.silk <= .35);
  motion.advance(1000);
  assert.equal(motion.time, time);
  motion.setActive(false); motion.advance(450);
  assert.equal(motion.eye, 0);
  assert.equal(motion.silk, 0);
});

// 羽根严格固定，左右节奏不同；连续函数在长时间采样和周期交界处也不能跳变。
test("feathers have fixed roots, independent smooth bounded tips", () => {
  let different = false;
  for (let time = 0; time < 60000; time += 37) {
    for (const side of [-1, 1]) {
      assert.deepEqual(featherPose(0, time, side, 1), { bend: 0, twist: 0 });
      const pose = featherPose(1, time, side, 1);
      assert.ok(Math.abs(pose.bend) <= 8 * Math.PI / 180 + 1e-8);
      assert.ok(Math.abs(featherPose(1, time + 1, side, 1).bend - pose.bend) < .001);
    }
    different ||= Math.abs(featherPose(1,time,-1,1).bend-featherPose(1,time,1,1).bend)>.01;
  }
  assert.ok(different);
});

// 新轮廓的细梢必须低于拱顶，且羽片、羽轴一起逐渐变细，不能退回笔直硬角。
test("plumes taper from a substantial root into a hanging elastic tip", () => {
  for (const side of [-1, 1]) {
    const root=featherSection(0,0,side,0);
    const middle=featherSection(.5,0,side,0);
    const tip=featherSection(1,0,side,0);
    const arch=Array.from({length:101},(_,i)=>featherSection(i/100,0,side,0));
    assert.ok(root.width>2.5 && middle.width<root.width && tip.width<root.width*.04);
    assert.ok(tip.shaft<root.shaft*.1);
    assert.ok(Math.max(...arch.map(p=>p.y))-tip.y>10,"细梢应自然耷拉到最高拱顶以下");
    assert.ok(tip.y<featherSection(.98,0,side,0).y,"末端切线应朝下");
    for (let time=0;time<15000;time+=173) {
      assert.deepEqual(featherSection(0,time,side,1),root);
      const a=featherSection(1,time,side,1),b=featherSection(1,time+1,side,1);
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<.06,"软梢必须连续回弹");
      assert.ok(Math.abs(a.x)<40 && a.y<40 && a.y>5,"软梢不能侵入文字或冠体");
    }
    // 沿长度产生相位滞后，外段不能只复制整根羽毛的刚体摆角。
    const near=featherPose(.4,1200,side,1).bend/.4**2;
    const far=featherPose(1,1200,side,1).bend;
    assert.ok(Math.abs(near-far)>.005);
  }
});

// 丝线从外眼角出发，任何相位都不能越过耳上缘所留的模型范围。
test("silk is rooted at the outer eye, tapered and bounded near its ear", () => {
  for (const side of [-1, 1]) for (let strand = 0; strand < 3; strand++) {
    assert.deepEqual(silkPoint(0, 1000, side, strand, 1), { x: side * 12.4, y: .6, z: 8.6, width: .28, alpha: 1 });
    // 展开、退出和长时间飘动共享同一外眼角，根部不能跟随伸长系数滑动。
    for(const extension of [0,.15,.5,1]) for(const time of [0,137,15999]) {
      assert.deepEqual(silkPoint(0,time,side,strand,extension),silkPoint(0,1000,side,strand,1));
    }
    for (let time=0; time<16000; time+=103) for(let i=0;i<=30;i++) {
      const p=silkPoint(i/30,time,side,strand,1);
      assert.ok(Math.abs(p.x)<=26.01 && p.y<=13.01 && p.y>=-.01);
      assert.ok(p.width>=0 && p.alpha>=0 && p.alpha<=1);
    }
    assert.equal(silkPoint(1,1000,side,strand,1).alpha,0);
    assert.equal(silkPoint(1,1000,side,strand,1).width,0);
  }
});
