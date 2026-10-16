// 酒吧小游戏逻辑：骰盅比大小（独立 Rapier 小世界）+ 俄罗斯轮盘 + 筹码。
// 不依赖 DOM。DiceWorld 需要注入 RAPIER；其余是纯逻辑。

import { mulberry32 } from './rng.js';

// ---------- 筹码 ----------
export class Chips {
  constructor(start = 100) { this.balance = start; }
  canBet(n) { return n > 0 && n <= this.balance; }
  bet(n) { if (!this.canBet(n)) return false; this.balance -= n; return true; }
  pay(n) { this.balance += n; }
}

// ---------- 俄罗斯轮盘 ----------
// 6 室左轮，1 发子弹。spin() 随机转轮；pull() 扣扳机（不转轮则子弹位置固定，必在 ≤6 次内响）。
export class Roulette {
  constructor({ seed = 666, chambers = 6 } = {}) {
    this.rng = mulberry32(seed);
    this.chambers = chambers;
    this.reset();
  }
  reset() {
    this.bullet = 0;
    this.pos = 0;
    this.pulls = 0;
    this.over = false;
    this.spin();
    this.pulls = 0;
  }
  spin() {
    this.bullet = this.rng.int(0, this.chambers - 1);
    this.pos = this.rng.int(0, this.chambers - 1);
    this.pulls = 0;
  }
  // 当前未响的剩余室数（假设子弹等概率在其中）
  remaining() { return this.chambers - this.pulls; }
  // 下一次安全的概率
  safeOdds() { const r = this.remaining(); return r <= 0 ? 0 : (r - 1) / r; }
  // 公平赔率倍数（累计）
  multiplier() {
    let m = 1;
    for (let i = 0; i < this.pulls; i++) m *= (this.chambers - i) / (this.chambers - i - 1);
    return m;
  }
  pull() {
    if (this.over) return { bang: false, over: true };
    const bang = this.pos === this.bullet;
    this.pos = (this.pos + 1) % this.chambers;
    this.pulls++;
    if (bang) this.over = true;
    return { bang, over: this.over, chamber: (this.pos + this.chambers - 1) % this.chambers };
  }
}

// ---------- 骰子 ----------
// 骰子局部轴对应点数：+y=1 −y=6 +x=2 −x=5 +z=3 −z=4（对面和为 7）
const FACE_AXES = [
  { n: 1, v: [0, 1, 0] }, { n: 6, v: [0, -1, 0] },
  { n: 2, v: [1, 0, 0] }, { n: 5, v: [-1, 0, 0] },
  { n: 3, v: [0, 0, 1] }, { n: 4, v: [0, 0, -1] },
];

function rotate(q, v) {
  // 四元数旋转向量
  const [x, y, z] = v;
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return [
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  ];
}

// 由四元数读出朝上的点数，并给出“平整度”（朝上轴与世界 y 的点积，越接近 1 越平）
export function topFace(q) {
  let best = null, bestDot = -2;
  for (const f of FACE_AXES) {
    const d = rotate(q, f.v)[1];
    if (d > bestDot) { bestDot = d; best = f.n; }
  }
  return { face: best, flat: bestDot };
}

export const DICE_HALF = 0.013;        // 骰子半边长（13 mm → 26 mm 骰）
export const CUP = { r: 0.045, h: 0.075, wall: 0.004 };

// 独立 Rapier 小世界：地面 + 骰盅（运动学刚体，由代码驱动摇、倒）+ N 颗骰子
export class DiceWorld {
  constructor(RAPIER, { seed = 7, count = 3 } = {}) {
    this.R = RAPIER;
    this.rng = mulberry32(seed);
    this.count = count;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 240;
    this.t = 0;
    this.dice = [];
    this.cup = null;
    this.phase = 'ready';           // ready | shaking | pouring | settling | done
    this.results = [];
    this._still = 0;
    const floor = RAPIER.ColliderDesc.cuboid(0.6, 0.05, 0.6)
      .setTranslation(0, -0.05, 0).setFriction(0.6).setRestitution(0.3);
    this.world.createCollider(floor);
    this._buildCup();
    this._spawnDice();
  }

  dispose() { this.world.free(); }

  _buildCup() {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CUP.h / 2 + 0.03, 0),
    );
    // 杯底 + 8 块侧壁近似圆筒
    this.world.createCollider(R.ColliderDesc.cuboid(CUP.r, CUP.wall / 2, CUP.r).setTranslation(0, -CUP.h / 2, 0).setFriction(0.5).setRestitution(0.2), body);
    const segs = 10;
    const halfW = CUP.r * Math.tan(Math.PI / segs);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const cx = Math.cos(a) * (CUP.r), cz = Math.sin(a) * (CUP.r);
      // 侧壁局部 z 轴要沿径向：绕 y 旋转 θ 后局部 z → (sinθ, cosθ)，令其 = (cos a, sin a)
      const th = Math.PI / 2 - a;
      this.world.createCollider(
        R.ColliderDesc.cuboid(halfW, CUP.h / 2, CUP.wall / 2)
          .setTranslation(cx, 0, cz)
          .setRotation({ x: 0, y: Math.sin(th / 2), z: 0, w: Math.cos(th / 2) })
          .setFriction(0.4).setRestitution(0.25),
        body,
      );
    }
    this.cup = body;
    this.cupBase = { x: 0, y: CUP.h / 2 + 0.03, z: 0 };
  }

  _spawnDice() {
    const R = this.R;
    this.dice = [];
    for (let i = 0; i < this.count; i++) {
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation((i - (this.count - 1) / 2) * 0.026, 0.03 + DICE_HALF + 0.01 + (i % 2) * 0.002, (this.rng() - 0.5) * 0.01)
          .setRotation(this._randQuat())
          .setCcdEnabled(true)
          .setLinearDamping(0.05).setAngularDamping(0.15),
      );
      this.world.createCollider(
        R.ColliderDesc.cuboid(DICE_HALF, DICE_HALF, DICE_HALF).setDensity(1400).setFriction(0.5).setRestitution(0.35),
        body,
      );
      this.dice.push(body);
    }
  }

  _randQuat() {
    const u1 = this.rng(), u2 = this.rng(), u3 = this.rng();
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    return {
      x: s1 * Math.sin(2 * Math.PI * u2), y: s1 * Math.cos(2 * Math.PI * u2),
      z: s2 * Math.sin(2 * Math.PI * u3), w: s2 * Math.cos(2 * Math.PI * u3),
    };
  }

  // 开始摇盅
  shake() {
    if (this.phase !== 'ready') return false;
    this.phase = 'shaking';
    this.t = 0;
    this._phi = [this.rng.range(0, 6.28), this.rng.range(0, 6.28), this.rng.range(0, 6.28)];
    return true;
  }

  // 运动学驱动曲线
  _driveCup() {
    const t = this.t;
    const b = this.cupBase;
    if (this.phase === 'shaking') {
      const A = 0.045, f = 11;
      const k = Math.min(1, t / 0.15);
      this.cup.setNextKinematicTranslation({
        x: b.x + A * k * Math.sin(2 * Math.PI * f * t + this._phi[0]),
        y: b.y + 0.035 * k * Math.abs(Math.sin(2 * Math.PI * f * 0.5 * t + this._phi[1])),
        z: b.z + A * 0.6 * k * Math.sin(2 * Math.PI * f * 0.8 * t + this._phi[2]),
      });
      if (t > 0.9) { this.phase = 'pouring'; this.t = 0; }
    } else if (this.phase === 'pouring') {
      // 0.5 s 内绕 z 轴翻转 160°，同时上抬，把骰子倒出
      const k = Math.min(1, t / 0.5);
      const ang = k * (Math.PI * 160 / 180);
      this.cup.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(ang / 2), w: Math.cos(ang / 2) });
      this.cup.setNextKinematicTranslation({ x: b.x - 0.05 * k, y: b.y + 0.07 * k, z: b.z });
      if (t > 0.8) { this.phase = 'settling'; this.t = 0; }
    } else if (this.phase === 'settling') {
      // 骰盅抬远，避免挡住
      const k = Math.min(1, t / 0.4);
      this.cup.setNextKinematicTranslation({ x: b.x - 0.05 - 0.15 * k, y: b.y + 0.07 + 0.2 * k, z: b.z });
    }
  }

  step() {
    if (this.phase === 'ready' || this.phase === 'done') return;
    this._driveCup();
    this.world.step();
    this.t += 1 / 240;
    if (this.phase === 'settling' && this.t > 0.4) {
      let still = true;
      for (const d of this.dice) {
        const v = d.linvel(), w = d.angvel();
        if (Math.hypot(v.x, v.y, v.z) > 0.02 || Math.hypot(w.x, w.y, w.z) > 0.2) { still = false; break; }
      }
      this._still = still ? this._still + 1 : 0;
      if (this._still > 30 || this.t > 6) this._finish();
    }
  }

  // 同步跑完（测试 / 快进）
  run(maxSeconds = 12) {
    if (this.phase === 'ready') this.shake();
    let n = 0;
    const max = Math.floor(maxSeconds * 240);
    while (this.phase !== 'done' && n < max) { this.step(); n++; }
    if (this.phase !== 'done') this._finish();
    return this.results;
  }

  _finish() {
    // 若骰子没落平（斜靠/叠放），吸附到最近的平放姿态
    this.results = this.dice.map((d) => {
      const q = d.rotation();
      const { face, flat } = topFace(q);
      return { face, flat, y: d.translation().y };
    });
    this.phase = 'done';
  }

  total() { return this.results.reduce((a, r) => a + r.face, 0); }

  // 供渲染只读
  snapshot() {
    const c = this.cup.translation(), cq = this.cup.rotation();
    return {
      phase: this.phase,
      cup: { x: c.x, y: c.y, z: c.z, qx: cq.x, qy: cq.y, qz: cq.z, qw: cq.w },
      dice: this.dice.map((d) => { const t = d.translation(), q = d.rotation(); return { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }; }),
    };
  }
}

// ---------- 比大小对局（庄家 vs 玩家，各自一副骰子点数总和） ----------
export function compareDice(playerTotal, houseTotal) {
  if (playerTotal > houseTotal) return 'win';
  if (playerTotal < houseTotal) return 'lose';
  return 'push';
}

export function settleDice(chips, stake, outcome) {
  if (outcome === 'win') chips.pay(stake * 2);
  else if (outcome === 'push') chips.pay(stake);
  return chips.balance;
}
