// 骰子扑克（Poker Dice）：五颗骰、最多三次投掷（首投 + 两次重投）、可留骰，和庄家比牌型。
//  • 纯逻辑：rankHand / compareHands / houseHolds / playHouse（不依赖 DOM 与物理，可直接测）
//  • DiceTray：Rapier 小世界，把“玩家的骰子”真实地抛在托盘里，落定后整齐归位到骰架（留骰 / 重投都在这里）
//    庄家的骰子不用物理：由 playHouse 用确定性随机数直接给出结果，渲染层在骰盅下“摇”完再揭开。

import { mulberry32 } from './rng.js';
import { topFace } from './bar.js';

// ---------------------------------------------------------------- 牌型
export const HANDS = ['high', 'pair', 'twoPair', 'trips', 'straight', 'fullHouse', 'four', 'five'];
// 赢牌时的奖金倍数（净赢 = 下注 × 倍数）。平局退回下注，输掉下注。
export const PAYOUT = { high: 1, pair: 1, twoPair: 1, trips: 1, straight: 2, fullHouse: 2, four: 3, five: 5 };

// faces：5 个 1..6 的点数。返回 { kind, rank, tie:[…], faces:[升序] }
export function rankHand(faces) {
  const f = [...faces].sort((a, b) => a - b);
  const cnt = new Map();
  for (const v of f) cnt.set(v, (cnt.get(v) || 0) + 1);
  // 按（出现次数 ↓，点数 ↓）排列的分组
  const groups = [...cnt.entries()].map(([face, n]) => ({ face, n })).sort((a, b) => b.n - a.n || b.face - a.face);
  const shape = groups.map((g) => g.n).join('');
  const tie = groups.map((g) => g.face);
  let kind;
  if (shape === '5') kind = 'five';
  else if (shape === '41') kind = 'four';
  else if (shape === '32') kind = 'fullHouse';
  else if (shape === '11111' && (f[4] - f[0] === 4)) { kind = 'straight'; }
  else if (shape === '311') kind = 'trips';
  else if (shape === '221') kind = 'twoPair';
  else if (shape === '2111') kind = 'pair';
  else kind = 'high';
  const t = kind === 'straight' ? [f[4]] : (kind === 'high' ? [...f].reverse() : tie);
  return { kind, rank: HANDS.indexOf(kind), tie: t, faces: f, groups };
}

// 比牌：先比牌型，再逐项比 tie（点数大者胜）；完全相同 → push
export function compareHands(a, b) {
  const ra = a.kind ? a : rankHand(a), rb = b.kind ? b : rankHand(b);
  if (ra.rank !== rb.rank) return ra.rank > rb.rank ? 'win' : 'lose';
  for (let i = 0; i < Math.max(ra.tie.length, rb.tie.length); i++) {
    const x = ra.tie[i] ?? 0, y = rb.tie[i] ?? 0;
    if (x !== y) return x > y ? 'win' : 'lose';
  }
  return 'push';
}

// 牌型说明文字所需的参数（给 i18n 用）：{ key, a, b }
export function describeHand(h) {
  const r = h.kind ? h : rankHand(h);
  const [a, b] = r.tie;
  return { kind: r.kind, a, b };
}

// ---------------------------------------------------------------- 庄家策略
// 给定当前点数，决定留哪些骰（true = 留）。启发式：成牌就停；否则留最大的组；四连缺一就博顺子。
export function houseHolds(faces) {
  const r = rankHand(faces);
  const hold = faces.map(() => false);
  const keepFace = (set) => faces.forEach((v, i) => { if (set.has(v)) hold[i] = true; });
  switch (r.kind) {
    case 'five': case 'four': case 'fullHouse': case 'straight': return faces.map(() => true);
    case 'trips': keepFace(new Set([r.tie[0]])); return hold;
    case 'twoPair': keepFace(new Set([r.tie[0], r.tie[1]])); return hold;
    case 'pair': keepFace(new Set([r.tie[0]])); return hold;
    default: {
      const u = new Set(faces);
      for (const lo of [1, 2]) {       // 差一张的顺子：1-5 或 2-6 中已有四个不同点
        const need = [lo, lo + 1, lo + 2, lo + 3, lo + 4];
        const have = need.filter((v) => u.has(v));
        if (have.length === 4) {
          const used = new Set();
          faces.forEach((v, i) => { if (have.includes(v) && !used.has(v)) { used.add(v); hold[i] = true; } });
          return hold;
        }
      }
      faces.forEach((v, i) => { if (v >= 5) hold[i] = true; });
      return hold;
    }
  }
}

// 庄家整局：最多 3 次投掷。rng：mulberry32。返回 { faces, rolls, history:[每次投掷后的点数] }
export function playHouse(rng, maxRolls = 3) {
  let faces = Array.from({ length: 5 }, () => rng.int(1, 6));
  const history = [[...faces]];
  let rolls = 1;
  while (rolls < maxRolls) {
    const hold = houseHolds(faces);
    if (hold.every(Boolean)) break;
    faces = faces.map((v, i) => (hold[i] ? v : rng.int(1, 6)));
    history.push([...faces]);
    rolls++;
  }
  return { faces, rolls, history };
}

// ---------------------------------------------------------------- 小四元数工具（x,y,z,w），不依赖 Three
const qMul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qNorm = (q) => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; };
const qFromTo = (u, v) => {
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (d < -0.99999) return { x: 1, y: 0, z: 0, w: 0 };
  return qNorm({ x: u[1] * v[2] - u[2] * v[1], y: u[2] * v[0] - u[0] * v[2], z: u[0] * v[1] - u[1] * v[0], w: 1 + d });
};
const qYaw = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
function qSlerp(a, b, t) {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bb = b;
  if (d < 0) { d = -d; bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; }
  if (d > 0.9995) return qNorm({ x: a.x + (bb.x - a.x) * t, y: a.y + (bb.y - a.y) * t, z: a.z + (bb.z - a.z) * t, w: a.w + (bb.w - a.w) * t });
  const th = Math.acos(d), s = Math.sin(th), w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s;
  return { x: a.x * w1 + bb.x * w2, y: a.y * w1 + bb.y * w2, z: a.z * w1 + bb.z * w2, w: a.w * w1 + bb.w * w2 };
}
const AXIS = { 1: [0, 1, 0], 6: [0, -1, 0], 2: [1, 0, 0], 5: [-1, 0, 0], 3: [0, 0, 1], 4: [0, 0, -1] };   // 与 bar.js 的 FACE_AXES 一致

// 让 face 朝上、绕竖直轴转 yaw 的姿态
export function quatFaceUp(face, yaw = 0) { return qNorm(qMul(qYaw(yaw), qFromTo(AXIS[face], [0, 1, 0]))); }

// ---------------------------------------------------------------- 托盘（玩家的骰子）
// 局部坐标：原点在托盘中心的毡面上，y 向上；+z 朝玩家（骰架在近端），-z 朝庄家。
export const TRAY = {
  half: 0.026,                 // 骰子半边长（52 mm 的大号酒吧骰）
  hx: 0.23, z0: -0.15, z1: 0.10,   // 投掷区：x ∈ [-hx, hx]，z ∈ [z0, z1]
  rackZ: 0.22, rackStep: 0.088, rackY: 0.006,   // 骰架：5 个槽，x = (i-2)·step
  houseZ: -0.30,               // 庄家骰子一排的 z
};
export const rackX = (slot) => (slot - 2) * TRAY.rackStep;

export class DiceTray {
  constructor(RAPIER, { seed = 11, count = 5 } = {}) {
    this.R = RAPIER;
    this.rng = mulberry32(seed);
    this.count = count;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 240;
    this.acc = 0;
    this.phase = 'idle';           // idle | rolling | tidy | ready
    this.faces = new Array(count).fill(0);      // 按槽位（ready 时有效）
    this.held = new Array(count).fill(false);
    this.rollNo = 0;               // 已投掷次数
    this.bodies = [];              // 当前在物理世界里的骰子 { body, mesh }
    this.pose = Array.from({ length: count }, (_, k) => this._restPose(k));
    this._tween = null;
    this._t = 0; this._still = 0; this._fix = 0;
    this._buildStatic();
  }

  dispose() { try { this.world.free(); } catch (_) { /* 已释放 */ } }

  _restPose(slot) {
    return { x: rackX(slot), y: TRAY.rackY + TRAY.half, z: TRAY.rackZ, q: quatFaceUp(1, 0) };
  }

  _buildStatic() {
    const R = this.R, w = this.world, T = TRAY;
    const add = (hx, hy, hz, x, y, z, fr = 0.5, re = 0.4) => w.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(fr).setRestitution(re));
    add(0.8, 0.05, 0.8, 0, -0.05, 0, 0.55, 0.32);                           // 毡面
    const cz = (T.z0 + T.z1) / 2, hz = (T.z1 - T.z0) / 2;
    add(0.02, 0.2, hz + 0.04, -T.hx - 0.02, 0.2, cz, 0.3, 0.5);             // 左右墙（比可见的高，兜住乱飞的骰子）
    add(0.02, 0.2, hz + 0.04, T.hx + 0.02, 0.2, cz, 0.3, 0.5);
    add(T.hx + 0.04, 0.2, 0.02, 0, 0.2, T.z0 - 0.02, 0.3, 0.5);             // 远端墙
    add(T.hx + 0.04, 0.2, 0.02, 0, 0.2, T.z1 + 0.02, 0.3, 0.5);             // 近端墙（骰架那一侧）
    add(T.hx + 0.04, 0.02, hz + 0.04, 0, 0.42, cz, 0.3, 0.2);               // 天花板（防飞出）
  }

  _randQuat() {
    const r = this.rng, u1 = r(), u2 = r(), u3 = r();
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    return { x: s1 * Math.sin(2 * Math.PI * u2), y: s1 * Math.cos(2 * Math.PI * u2), z: s2 * Math.sin(2 * Math.PI * u3), w: s2 * Math.cos(2 * Math.PI * u3) };
  }

  // 重投：indices = 要抛的槽位；省略 → 抛所有没留的。首投时全部抛。
  throwDice(indices = null) {
    if (this.phase === 'rolling' || this.phase === 'tidy') return false;
    const R = this.R, T = TRAY;
    const idx = indices || this.held.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return false;
    for (const b of this.bodies) this.world.removeRigidBody(b.body);
    this.bodies = [];
    const n = idx.length;
    idx.forEach((slot, j) => {
      const x = (j - (n - 1) / 2) * 0.085 + this.rng.range(-0.015, 0.015);
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(x, 0.12 + this.rng.range(0, 0.08), T.z1 - 0.03 + this.rng.range(-0.01, 0.01))
          .setRotation(this._randQuat())
          .setLinvel(this.rng.range(-0.45, 0.45), this.rng.range(0.5, 1.1), -this.rng.range(1.5, 2.4))
          .setAngvel({ x: this.rng.range(-38, 38), y: this.rng.range(-38, 38), z: this.rng.range(-38, 38) })
          .setCcdEnabled(true).setLinearDamping(0.08).setAngularDamping(0.25),
      );
      this.world.createCollider(R.ColliderDesc.cuboid(T.half, T.half, T.half).setDensity(1400).setFriction(0.5).setRestitution(0.38), body);
      this.bodies.push({ body, slot });
    });
    this.rollNo++;
    this.phase = 'rolling'; this._t = 0; this._still = 0; this._fix = 0;
    this._thrown = idx;
    return true;
  }

  toggleHold(slot) {
    if (this.phase !== 'ready' || slot < 0 || slot >= this.count) return false;
    this.held[slot] = !this.held[slot];
    return true;
  }

  _readBodies() { return this.bodies.map((b) => { const q = b.body.rotation(); return { ...topFace(q), y: b.body.translation().y }; }); }

  _settled() {
    for (const b of this.bodies) {
      const v = b.body.linvel(), w = b.body.angvel();
      if (Math.hypot(v.x, v.y, v.z) > 0.03 || Math.hypot(w.x, w.y, w.z) > 0.3) return false;
    }
    return true;
  }

  // 推进 dt 秒（真实时间）
  step(dt) {
    if (this.phase === 'rolling') {
      this.acc += Math.min(dt, 0.05);
      while (this.acc >= 1 / 240) {
        this.world.step(); this.acc -= 1 / 240; this._t += 1 / 240;
        this._still = this._settled() ? this._still + 1 : 0;
        if (this._still > 50 || this._t > 6) { this._onSettle(); break; }
      }
    } else if (this.phase === 'tidy') {
      const tw = this._tween;
      tw.t += dt;
      const u = Math.max(0, Math.min(1, tw.t / tw.dur));
      for (const m of tw.moves) {
        const e = u * u * (3 - 2 * u);
        const p = this.pose[m.k];
        p.x = m.from.x + (m.to.x - m.from.x) * e;
        p.z = m.from.z + (m.to.z - m.from.z) * e;
        p.y = m.from.y + (m.to.y - m.from.y) * e + Math.sin(e * Math.PI) * 0.05;
        p.q = qSlerp(m.from.q, m.to.q, e);
      }
      if (u >= 1) this._finishTidy();
    }
  }

  _onSettle() {
    // 没落平（斜靠 / 叠放）的骰子：轻轻弹一下重来，最多 3 次；还不行就直接扶正
    const info = this._readBodies();
    const cocked = info.map((r, i) => (r.flat < 0.985 ? i : -1)).filter((i) => i >= 0);
    if (cocked.length && this._fix < 3) {
      this._fix++;
      for (const i of cocked) {
        const b = this.bodies[i].body;
        b.setLinvel({ x: this.rng.range(-0.3, 0.3), y: 0.9, z: this.rng.range(-0.3, 0.3) }, true);
        b.setAngvel({ x: this.rng.range(-12, 12), y: this.rng.range(-12, 12), z: this.rng.range(-12, 12) }, true);
      }
      this._still = 0; this._t = Math.min(this._t, 4.5);
      return;
    }
    // 扶正残留的斜骰
    for (let i = 0; i < this.bodies.length; i++) {
      if (info[i].flat >= 0.985) continue;
      const b = this.bodies[i].body, q = b.rotation();
      b.setRotation(quatFaceUp(info[i].face, Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z))), true);
    }
    const fin = this._readBodies();
    // 抛出的骰子按点数升序，依次放进空槽（留着的骰子保持原槽位）
    const free = [...this._thrown].sort((a, b) => a - b);
    const order = fin.map((r, i) => ({ i, face: r.face })).sort((a, b) => a.face - b.face || a.i - b.i);
    const moves = [];
    order.forEach((o, j) => {
      const slot = free[j];
      const body = this.bodies[o.i].body, t = body.translation(), q = body.rotation();
      const from = { x: t.x, y: t.y, z: t.z, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
      const yaw = this.rng.range(-0.18, 0.18);
      moves.push({ k: slot, slot, face: o.face, from, to: { x: rackX(slot), y: TRAY.rackY + TRAY.half, z: TRAY.rackZ, q: quatFaceUp(o.face, yaw) } });
      this.pose[slot] = { x: from.x, y: from.y, z: from.z, q: from.q };
    });
    // 在物理世界里冻结结果的显示：快照只读 pose，所以先把 pose 写成落定姿态
    for (const b of this.bodies) this.world.removeRigidBody(b.body);
    this.bodies = [];
    this._tween = { t: -0.35, dur: 0.5, moves };      // 先停 0.35 s 让玩家看清点数再归位
    this.phase = 'tidy';
  }

  _finishTidy() {
    for (const m of this._tween.moves) {
      this.faces[m.slot] = m.face;
      this.pose[m.slot] = { x: m.to.x, y: m.to.y, z: m.to.z, q: m.to.q };
    }
    this._tween = null;
    this.phase = 'ready';
  }

  // 渲染只读：每个槽位一颗骰 + 在物理里的骰子实时姿态
  snapshot() {
    const out = this.pose.map((p, k) => ({ x: p.x, y: p.y, z: p.z, qx: p.q.x, qy: p.q.y, qz: p.q.z, qw: p.q.w, held: this.held[k], face: this.faces[k] }));
    if (this.phase === 'rolling') {
      for (const b of this.bodies) {
        const t = b.body.translation(), q = b.body.rotation(), o = out[b.slot];
        o.x = t.x; o.y = t.y; o.z = t.z; o.qx = q.x; o.qy = q.y; o.qz = q.z; o.qw = q.w;
      }
    }
    return out;
  }

  // 同步跑完一次投掷（测试 / 快进）
  run(maxSeconds = 20) {
    let n = 0; const max = Math.floor(maxSeconds / (1 / 60));
    while ((this.phase === 'rolling' || this.phase === 'tidy') && n++ < max) this.step(1 / 60);
    return this.faces;
  }
}
