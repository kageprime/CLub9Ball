// 物理核心：Rapier 刚体台球。物理是唯一事实源；渲染层只读 snapshot，不写回。
// 不依赖 DOM，可在 Node 跑。RAPIER 由调用方注入（浏览器：rapier3d-compat；Node：同一个包）。
//
//   import RAPIER from '@dimforge/rapier3d-compat'; await RAPIER.init();
//   const sim = new Sim(RAPIER, { seed: 9 });

import { mulberry32 } from './rng.js';
import {
  BALL_R, BALL_MASS, HALF_L, HALF_W, CUSHION_H, CUSHION_T,
  POCKETS, CORNER_MOUTH, SIDE_MOUTH, FOOT_SPOT, HEAD_SPOT, MAT, PHYS,
} from './table.js';

const R = BALL_R;
export const SNAP_STRIDE = 8; // n, x, y, z, qx, qy, qz, qw

// ---------- 纯函数：瞄准线求解（不依赖 Rapier，可单测） ----------
// balls: [{n,x,z}]（不含母球）；cue: {x,z}；angle: 弧度，方向 (cos, sin) 对应 (x, z)
export function traceAim(cue, balls, angle, maxBounces = 1) {
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const pts = [{ x: cue.x, z: cue.z }];
  let ox = cue.x, oz = cue.z, vx = dx, vz = dz;
  let hit = null;
  for (let bounce = 0; bounce <= maxBounces; bounce++) {
    // 最近的球（圆心距 2R）
    let bestT = Infinity, bestBall = null;
    for (const b of balls) {
      const rx = b.x - ox, rz = b.z - oz;
      const proj = rx * vx + rz * vz;
      if (proj <= 0) continue;
      const d2 = rx * rx + rz * rz - proj * proj;
      const lim = 4 * R * R;
      if (d2 >= lim) continue;
      const t = proj - Math.sqrt(lim - d2);
      if (t > 1e-6 && t < bestT) { bestT = t; bestBall = b; }
    }
    // 库边（球心可达区域为 HALF - R）
    const lx = HALF_L - R, lz = HALF_W - R;
    let tWall = Infinity;
    if (vx > 1e-9) tWall = Math.min(tWall, (lx - ox) / vx);
    if (vx < -1e-9) tWall = Math.min(tWall, (-lx - ox) / vx);
    if (vz > 1e-9) tWall = Math.min(tWall, (lz - oz) / vz);
    if (vz < -1e-9) tWall = Math.min(tWall, (-lz - oz) / vz);

    if (bestBall && bestT <= tWall) {
      const gx = ox + vx * bestT, gz = oz + vz * bestT;
      pts.push({ x: gx, z: gz });
      // 目标球飞行方向：沿 母球心→目标球心
      let nx = bestBall.x - gx, nz = bestBall.z - gz;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      // 母球切线方向（弹开后）
      const dot = vx * nx + vz * nz;
      const tx = vx - dot * nx, tz = vz - dot * nz;
      hit = { ball: bestBall.n, ghost: { x: gx, z: gz }, objDir: { x: nx, z: nz }, cueDir: { x: tx, z: tz }, cut: Math.acos(Math.min(1, Math.max(-1, dot))) };
      return { points: pts, hit };
    }
    // 撞库
    const wx = ox + vx * tWall, wz = oz + vz * tWall;
    pts.push({ x: wx, z: wz });
    ox = wx; oz = wz;
    if (Math.abs(Math.abs(wx) - lx) < 1e-6) vx = -vx;
    if (Math.abs(Math.abs(wz) - lz) < 1e-6) vz = -vz;
  }
  return { points: pts, hit };
}

// 球堆位置（顶球在置球点，向 +x 方向展开；8 号在第三排中间）
export function rackLayout(rng) {
  const dx = R * Math.sqrt(3) + 0.0004;
  const dz = R * 2 + 0.0004;
  const slots = [];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      slots.push({ x: FOOT_SPOT.x + row * dx, z: FOOT_SPOT.z + (k - row / 2) * dz, row, k });
    }
  }
  // 编号分配：8 在中心(第 3 排中间)，后排两角一实一花，其余随机
  const nums = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const centerIdx = slots.findIndex((s) => s.row === 2 && s.k === 1);
  const cornerA = slots.findIndex((s) => s.row === 4 && s.k === 0);
  const cornerB = slots.findIndex((s) => s.row === 4 && s.k === 4);
  const assign = new Array(15);
  assign[centerIdx] = 8;
  const solids = nums.filter((n) => n < 8);
  const stripes = nums.filter((n) => n > 8);
  assign[cornerA] = solids.pop();
  assign[cornerB] = stripes.pop();
  const rest = [...solids, ...stripes];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  let ri = 0;
  for (let i = 0; i < 15; i++) if (assign[i] === undefined) assign[i] = rest[ri++];
  return slots.map((s, i) => ({ n: assign[i], x: s.x, z: s.z }));
}

export class Sim {
  constructor(RAPIER, opts = {}) {
    this.RAPIER = RAPIER;
    this.seed = opts.seed ?? 9;
    this.rng = mulberry32(this.seed);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYS.dt;
    try { this.world.integrationParameters.numSolverIterations = 8; } catch (_) { /* 版本差异，忽略 */ }
    this.queue = new RAPIER.EventQueue(true);
    this.colMap = new Map();     // collider handle → {kind, n}
    this.balls = new Array(16).fill(null);   // 刚体；null = 已落袋
    this.pocketedInfo = new Array(16).fill(null);
    this.acc = 0;
    this.simTime = 0;
    this.stepCount = 0;
    this.phase = 'idle';         // 'idle' | 'rolling'
    this.events = [];            // 供外部 drain 的语义事件
    this.onSample = null;        // (sim) => void，每 4 步（60 Hz）调用，供回放录制
    this.stillSteps = 0;
    this._pre = new Float32Array(16 * 3);
    this._buildTable();
    this.rerack();
  }

  dispose() { this.world.free(); }

  // ---------- 台面 ----------
  _addFixed(hx, hy, hz, x, y, z, mat, kind, rotY = 0) {
    const RAPIER = this.RAPIER;
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z)
      .setFriction(mat.friction)
      .setRestitution(mat.restitution)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
    if (rotY) desc.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    const col = this.world.createCollider(desc);
    this.colMap.set(col.handle, { kind });
    return col;
  }

  _buildTable() {
    // 台面（延伸出库边以接住飞出的球）
    this._addFixed(HALF_L + 0.3, 0.05, HALF_W + 0.3, 0, -0.05, 0, MAT.bed, 'bed');
    const hh = CUSHION_H / 2, cy = CUSHION_H / 2, ht = CUSHION_T / 2;
    // 长边库（上下各两段，中袋处断开）
    const longSegHalf = (HALF_L - CORNER_MOUTH - SIDE_MOUTH) / 2;
    const longCx = (HALF_L - CORNER_MOUTH + SIDE_MOUTH) / 2;
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        this._addFixed(longSegHalf, hh, ht, sx * longCx, cy, sz * (HALF_W + ht), MAT.cushion, 'cushion');
      }
    }
    // 短边库：覆盖 z ∈ [-(HALF_W-CM), +(HALF_W-CM)]，两端是角袋缺口
    for (const sx of [-1, 1]) {
      this._addFixed(ht, hh, HALF_W - CORNER_MOUTH, sx * (HALF_L + ht), cy, 0, MAT.cushion, 'cushion');
    }
    // 角袋后挡块：垂直于角对角线的小斜块，落袋判定之外的安全兜底
    for (const p of POCKETS) {
      if (p.kind !== 'corner') continue;
      const sx = Math.sign(p.x), sz = Math.sign(p.z);
      // Rapier 绕 y 旋转 θ 时，局部 x 轴指向 (cosθ, 0, -sinθ)；需要它平行于 (-sz, sx)
      const theta = Math.atan2(-sx, -sz);
      this._addFixed(0.05, hh, 0.012, p.x + sx * 0.085, cy, p.z + sz * 0.085, MAT.cushion, 'cushion', theta);
    }
    // 袋后挡板：落袋判定半径之外，防止球飞出桌外太远
    this._addFixed(0.02, 0.2, HALF_W + 0.3, -(HALF_L + 0.3), 0.15, 0, MAT.cushion, 'cushion');
    this._addFixed(0.02, 0.2, HALF_W + 0.3, (HALF_L + 0.3), 0.15, 0, MAT.cushion, 'cushion');
    this._addFixed(HALF_L + 0.3, 0.2, 0.02, 0, 0.15, -(HALF_W + 0.3), MAT.cushion, 'cushion');
    this._addFixed(HALF_L + 0.3, 0.2, 0.02, 0, 0.15, (HALF_W + 0.3), MAT.cushion, 'cushion');
  }

  // ---------- 球 ----------
  _spawn(n, x, z) {
    const RAPIER = this.RAPIER;
    if (this.balls[n]) this._remove(n);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, R + 0.0002, z)
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setLinearDamping(0)
        .setAngularDamping(0),
    );
    const density = BALL_MASS / ((4 / 3) * Math.PI * R * R * R);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(R)
        .setDensity(density)
        .setFriction(MAT.ball.friction)
        .setRestitution(MAT.ball.restitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.colMap.set(col.handle, { kind: 'ball', n });
    body._col = col;
    this.balls[n] = body;
    this.pocketedInfo[n] = null;
    return body;
  }

  _remove(n) {
    const b = this.balls[n];
    if (!b) return;
    this.colMap.delete(b._col.handle);
    this.world.removeRigidBody(b);
    this.balls[n] = null;
  }

  rerack() {
    for (let n = 0; n < 16; n++) this._remove(n);
    const layout = rackLayout(this.rng);
    for (const s of layout) this._spawn(s.n, s.x, s.z);
    this._spawn(0, HEAD_SPOT.x, HEAD_SPOT.z);
    this.racked = true;
    this.phase = 'idle';
    this.acc = 0;
    this._resetShot();
  }

  _resetShot() {
    this.shot = { firstContact: null, pocketed: [], railAfterContact: false, railHits: 0, struck: false, time: 0 };
  }

  // 母球是否在台面上
  cueOnTable() { return !!this.balls[0]; }

  // 自由球：把母球放到 (x,z)。合法返回 true。
  placeCue(x, z, { behindHead = false } = {}) {
    const lim = (v, h) => Math.max(-h + R, Math.min(h - R, v));
    x = lim(x, HALF_L); z = lim(z, HALF_W);
    if (behindHead && x > HEAD_SPOT.x) x = HEAD_SPOT.x;
    for (let n = 1; n < 16; n++) {
      const b = this.balls[n];
      if (!b) continue;
      const t = b.translation();
      if (Math.hypot(t.x - x, t.z - z) < 2 * R + 0.001) return false;
    }
    // 袋口禁区
    for (const p of POCKETS) if (Math.hypot(p.x - x, p.z - z) < p.capture + R) return false;
    this._spawn(0, x, z);
    return true;
  }

  // 非球堆里的目标球摆回（8 号开球落袋后重置）
  respotBall(n) {
    // 从置球点向 +x 方向找空位
    let x = FOOT_SPOT.x;
    for (let i = 0; i < 40; i++, x += 2 * R + 0.001) {
      if (this._free(x, FOOT_SPOT.z)) { this._spawn(n, x, FOOT_SPOT.z); return true; }
    }
    return false;
  }
  _free(x, z) {
    for (let n = 0; n < 16; n++) {
      const b = this.balls[n]; if (!b) continue;
      const t = b.translation();
      if (Math.hypot(t.x - x, t.z - z) < 2 * R + 0.001) return false;
    }
    return true;
  }

  // ---------- 击球 ----------
  // angle：水平瞄准角（弧度，(cos,sin)→(x,z)）；power：0..1；
  // spinX：-1..1（正=右塞）；spinY：-1..1（正=高杆/推杆，负=低杆/拉杆）
  strike({ angle, power, spinX = 0, spinY = 0 }) {
    const cue = this.balls[0];
    if (!cue || this.phase !== 'idle') return false;
    const p = Math.max(0, Math.min(1, power));
    // 杆速与力度为二次关系：中等力度≈真实中等杆速（半力约 2.7 m/s，实测 medium/fast 区间），
    // 只有接近满力才到开球速度（10 m/s）。线性映射会让半力变成“暴力杆”，球显得快得离谱。
    const speed = PHYS.minCueSpeed + (PHYS.maxCueSpeed - PHYS.minCueSpeed) * p * p;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    // right = d × up = (-dz·0..)：对 d=(dx,0,dz)，up=(0,1,0) → right=(-dz, 0, dx) 的镜像；
    // 用叉积直接算：d × up = (dy*0 - dz*1, dz*0 - dx*0, dx*1 - dy*0) → (-dz, 0, dx)
    const rx = -dz, rz = dx;
    const maxOff = 0.6 * R;
    let ox = Math.max(-1, Math.min(1, spinX)) * maxOff;
    let oy = Math.max(-1, Math.min(1, spinY)) * maxOff;
    const off = Math.hypot(ox, oy);
    if (off > maxOff) { ox *= maxOff / off; oy *= maxOff / off; }
    const depth = Math.sqrt(Math.max(0, R * R - ox * ox - oy * oy));
    const t = cue.translation();
    const point = {
      x: t.x + rx * ox - dx * depth,
      y: t.y + oy,
      z: t.z + rz * ox - dz * depth,
    };
    const J = BALL_MASS * speed;
    this._resetShot();
    this.shot.struck = true;
    cue.applyImpulseAtPoint({ x: dx * J, y: 0, z: dz * J }, point, true);
    this.phase = 'rolling';
    this.stillSteps = 0;
    this.events.push({ type: 'strike', power: p, speed, t: this.simTime, isBreak: this.racked });
    this.racked = false;
    return true;
  }

  // ---------- 步进 ----------
  advance(dtReal) {
    this.acc += Math.min(dtReal, 0.1);
    let steps = 0;
    while (this.acc >= PHYS.dt && steps < 40) {
      this._step();
      this.acc -= PHYS.dt;
      steps++;
    }
    return steps;
  }

  // 同步跑到静止（测试与快进用），返回步数
  runUntilStill(maxSeconds = 60) {
    let n = 0;
    const max = Math.floor(maxSeconds / PHYS.dt);
    while (this.phase === 'rolling' && n < max) { this._step(); n++; }
    return n;
  }

  _step() {
    // 记录步前速度（用于碰撞强度）
    for (let n = 0; n < 16; n++) {
      const b = this.balls[n];
      if (b) { const v = b.linvel(); this._pre[n * 3] = v.x; this._pre[n * 3 + 1] = v.y; this._pre[n * 3 + 2] = v.z; }
    }
    this.world.step(this.queue);
    this.simTime += PHYS.dt;
    this.stepCount++;
    if (this.phase === 'rolling') this.shot.time += PHYS.dt;

    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.colMap.get(h1), b = this.colMap.get(h2);
      if (!a || !b) return;
      if (a.kind === 'ball' && b.kind === 'ball') this._ballBall(a.n, b.n);
      else if (a.kind === 'ball' && b.kind === 'cushion') this._ballCushion(a.n);
      else if (b.kind === 'ball' && a.kind === 'cushion') this._ballCushion(b.n);
    });

    this._dampAndPocket();
    if (this.onSample && this.stepCount % 4 === 0) this.onSample(this);

    if (this.phase === 'rolling') {
      let moving = false;
      for (let n = 0; n < 16; n++) if (this.balls[n] && !this.balls[n]._still) { moving = true; break; }
      if (!moving || this.shot.time > 45) {
        this.stillSteps++;
        if (this.stillSteps > 12) {
          this.phase = 'idle';
          // 全部强制归零
          for (let n = 0; n < 16; n++) {
            const b = this.balls[n]; if (!b) continue;
            b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
          this.events.push({ type: 'shotEnd', report: this.shotReport(), t: this.simTime });
        }
      } else {
        this.stillSteps = 0;
      }
    }
  }

  _relSpeed(a, b) {
    const i = a * 3, j = b * 3;
    const dx = this._pre[i] - this._pre[j], dz = this._pre[i + 2] - this._pre[j + 2];
    return Math.hypot(dx, dz);
  }

  _ballBall(a, b) {
    const speed = this._relSpeed(a, b);
    if (this.shot.struck && this.shot.firstContact == null && (a === 0 || b === 0)) {
      this.shot.firstContact = a === 0 ? b : a;
    }
    this.events.push({ type: 'ballHit', a, b, speed, t: this.simTime });
  }

  _ballCushion(n) {
    const i = n * 3;
    const speed = Math.hypot(this._pre[i], this._pre[i + 2]);
    if (this.shot.struck) {
      this.shot.railHits++;
      if (this.shot.firstContact != null) this.shot.railAfterContact = true;
    }
    this.events.push({ type: 'cushion', ball: n, speed, t: this.simTime });
  }

  _dampAndPocket() {
    const dt = PHYS.dt;
    for (let n = 0; n < 16; n++) {
      const b = this.balls[n];
      if (!b) continue;
      const t = b.translation();

      // 落袋判定
      let pocket = -2;
      for (const p of POCKETS) {
        if (Math.hypot(t.x - p.x, t.z - p.z) < p.capture) { pocket = p.id; break; }
      }
      // 兜底：库边是实心的，球心越过库边平面只可能是从袋口缺口滑出去的 → 判落袋（记到最近的袋）
      if (pocket === -2 && (t.y < -0.25 || Math.abs(t.x) > HALF_L + 0.02 || Math.abs(t.z) > HALF_W + 0.02)) {
        let bd = Infinity; pocket = -1;
        for (const p of POCKETS) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; pocket = p.id; } }
      }
      if (pocket !== -2) {
        const v = b.linvel();
        this.pocketedInfo[n] = { pocket, x: t.x, y: t.y, z: t.z, vx: v.x, vz: v.z, t: this.simTime };
        this._remove(n);
        if (this.shot.struck) this.shot.pocketed.push(n);
        this.events.push({ type: 'pocket', ball: n, pocket, t: this.simTime, speed: Math.hypot(v.x, v.z) });
        continue;
      }

      const v = b.linvel();
      const w = b.angvel();
      const onBed = t.y < R + 0.004 && Math.abs(v.y) < 0.2;
      if (onBed) {
        // 滚动阻力（恒定减速），按比例同时缩放水平线速度和水平角速度
        const sp = Math.hypot(v.x, v.z);
        let nvx = v.x, nvz = v.z, nwx = w.x, nwz = w.z, nwy = w.y;
        if (sp > 0) {
          const ns = Math.max(0, sp - PHYS.rollDecel * dt);
          const k = ns / sp;
          nvx *= k; nvz *= k; nwx *= k; nwz *= k;
        }
        // 纵轴自旋衰减
        if (nwy > 0) nwy = Math.max(0, nwy - PHYS.spinDecel * dt);
        else if (nwy < 0) nwy = Math.min(0, nwy + PHYS.spinDecel * dt);
        const spd = Math.hypot(nvx, nvz);
        const angH = Math.hypot(nwx, nwz) * R;
        if (spd < PHYS.sleepSpeed && angH < PHYS.sleepSpeed * 2 + 0.01) {
          b._still = true;
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        } else {
          b._still = false;
          b.setLinvel({ x: nvx, y: v.y, z: nvz }, true);
          b.setAngvel({ x: nwx, y: nwy, z: nwz }, true);
        }
      } else {
        b._still = false;
      }
    }
  }

  // ---------- 读取（只读） ----------
  shotReport() {
    return {
      firstContact: this.shot.firstContact,
      pocketed: [...this.shot.pocketed],
      railAfterContact: this.shot.railAfterContact,
      railHits: this.shot.railHits,
    };
  }

  drainEvents() { const e = this.events; this.events = []; return e; }

  isStill() { return this.phase === 'idle'; }

  ballPos(n) {
    const b = this.balls[n]; if (!b) return null;
    const t = b.translation(); return { x: t.x, y: t.y, z: t.z };
  }

  // 静止球位置（目标球），供瞄准线使用
  objectBalls() {
    const out = [];
    for (let n = 1; n < 16; n++) { const p = this.ballPos(n); if (p) out.push({ n, x: p.x, z: p.z }); }
    return out;
  }

  aimTrace(angle) {
    const c = this.ballPos(0);
    if (!c) return null;
    return traceAim(c, this.objectBalls(), angle);
  }

  // 写入 Float32Array(16*SNAP_STRIDE)：n, x, y, z, qx, qy, qz, qw；已落袋的球 n 取负（-n-1），位置为落袋点
  snapshotInto(buf) {
    for (let n = 0; n < 16; n++) {
      const o = n * SNAP_STRIDE;
      const b = this.balls[n];
      if (b) {
        const t = b.translation(), q = b.rotation();
        buf[o] = n; buf[o + 1] = t.x; buf[o + 2] = t.y; buf[o + 3] = t.z;
        buf[o + 4] = q.x; buf[o + 5] = q.y; buf[o + 6] = q.z; buf[o + 7] = q.w;
      } else {
        const info = this.pocketedInfo[n];
        buf[o] = -n - 1;
        buf[o + 1] = info ? info.x : 0; buf[o + 2] = info ? info.y : -1; buf[o + 3] = info ? info.z : 0;
        buf[o + 4] = 0; buf[o + 5] = 0; buf[o + 6] = 0; buf[o + 7] = 1;
      }
    }
    return buf;
  }

  snapshot() { return this.snapshotInto(new Float32Array(16 * SNAP_STRIDE)); }
}
