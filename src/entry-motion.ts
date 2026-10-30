const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** 每次反向都以当前值为起点；不重置相位，也不把上次退出排进下一次交互。 */
class Envelope {
  value = 0;
  private from = 0;
  private target = 0;
  private elapsed = 0;
  private duration = 0;
  private delay = 0;
  constructor(initial = 0) {
    // 允许从后备图当前可见的眼色接续；初始目标也同步，避免无交互时误报运动。
    this.value = this.from = this.target = Math.max(0, Math.min(1, initial));
  }
  to(target: number, duration: number, delay = 0) {
    this.from = this.value;
    this.target = target;
    this.elapsed = 0;
    this.duration = duration;
    this.delay = delay;
  }
  advance(delta: number) {
    if (this.duration === 0) return;
    this.elapsed += delta;
    this.value = this.from + (this.target - this.from) * smooth((this.elapsed - this.delay) / this.duration);
  }
  get moving() { return this.value !== this.target; }
}

/** 时间只由可见页面的共享调度器推进，隐藏和减少动态均不消耗循环相位。 */
export class EntryMotion {
  active = false;
  reduced = false;
  time = 0;
  private intensity = new Envelope();
  private eyes: Envelope;
  private threads = new Envelope();
  constructor(initialEye = 0) {
    // 首帧保留后备红眼；若加载结束前已经移出，则继续平滑退出，其他动画仍从静止开始。
    this.eyes = new Envelope(initialEye);
    this.eyes.to(0, 450);
  }
  get amount() { return this.intensity.value; }
  get eye() { return this.eyes.value; }
  get silk() { return this.reduced ? Math.min(.3, this.threads.value) : this.threads.value; }
  get running() {
    return (this.active && !this.reduced) || this.intensity.moving || this.eyes.moving || this.threads.moving;
  }
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.intensity.to(active ? 1 : 0, active ? 300 : 450);
    this.eyes.to(active ? 1 : 0, active ? 350 : 450);
    // 初次先亮眼再舒展；已有丝线时从原长度直接衔接，快速重入不会突然缩短。
    this.threads.to(active ? 1 : 0, active ? 800 : 450, active && this.threads.value === 0 ? 350 : 0);
  }
  advance(delta: number) {
    const elapsed = Math.max(0, delta);
    if (!this.reduced && (this.active || this.amount > 0)) this.time += elapsed;
    this.intensity.advance(elapsed);
    this.eyes.advance(elapsed);
    this.threads.advance(elapsed);
  }
}

/** 连续的非同周期谐波近似缓慢阵风；二次权重让根部位移和一阶导数都为零。 */
export function featherPose(t: number, time: number, side: number, amount: number) {
  if (t === 0 || amount === 0) return { bend: 0, twist: 0 };
  const seconds = time / 1000;
  // 风的响应沿长度逐渐滞后，细梢追随粗段再回弹，避免整根像硬角一样同步旋转。
  const phase = (side < 0 ? .37 : 2.13) - t * 1.65;
  const wind = .62 * Math.sin(seconds * Math.PI * 2 / (side < 0 ? 4.3 : 3.7) + phase)
    + .26 * Math.sin(seconds * Math.PI * 2 / 6.71 + phase * 2)
    + .12 * Math.sin(seconds * Math.PI * 2 / 2.93 + phase * .7);
  const weight = t * t * amount;
  return {
    bend: weight * wind * 8 * Math.PI / 180,
    twist: weight * Math.sin(seconds * Math.PI * 2 / 4.7 + phase) * .18,
  };
}

/** 粗根承重、末梢自然回垂；羽片和羽轴共同收尖，静止时也保留柔软的拱垂剪影。 */
export function featherSection(t: number, time: number, side: number, amount: number) {
  const pose=featherPose(t,time,side,amount);
  const restX=side*(23*t+3*Math.sin(Math.PI*t));
  const restY=74*t-49*t**4;
  const cos=Math.cos(pose.bend),sin=Math.sin(pose.bend);
  const phase=time/1000*Math.PI*2/4.1-t*3+(side<0?.8:2.4);
  // 最后四分之一更柔软；小幅垂直回弹叠加缓慢弯摆，根部始终严格固定。
  const rebound=amount*t**4*Math.sin(phase)*3.8;
  const taper=(1-t)**.95;
  return {
    x:side*6+restX*cos-restY*sin,
    y:-11+restX*sin+restY*cos+rebound,
    z:1+amount*t*t*Math.sin(phase*.73)*1.1,
    width:.08+2.9*taper,
    shaft:.015+.24*(1-t)**1.25,
    twist:pose.twist,
  };
}

/** 范围以猴头模型坐标约束，末端不越过同侧耳上缘；零长度仍固定在外眼角。 */
export function silkPoint(t: number, time: number, side: number, strand: number, extension: number) {
  const u = t * Math.max(0, Math.min(1, extension));
  const phase = time / 1000 * Math.PI * 2 / (3.3 + strand * .27) + strand * 1.9 + side * .8;
  const flutter = Math.sin(Math.PI * u) * Math.sin(phase + u * 3.2);
  return {
    // 新的大眼外角略高于瞳孔；长度相应缩短，仍然止于同侧耳上方的透明区。
    x: side * (12.4 + u * (12.6 - strand * 1.2)),
    y: .6 + u * (10.9 - strand * 3.6) + flutter * 1.15,
    z: 8.6 + Math.sin(Math.PI * u) * Math.sin(phase * .73) * .5,
    width: .28 * (1 - t) ** .7,
    alpha: (1 - t) ** .6,
  };
}
