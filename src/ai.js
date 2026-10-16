// 简易球手 AI：触屏观战模式用（也可做陪练）。纯几何，不依赖 Rapier / DOM。
// 思路：对每个合法目标球 × 每个袋口，求“幽灵球”位置，检查两段路径是否被挡、切角是否过大，
// 打分后取最优；再按技术加一点高斯角误差。

import { BALL_R, HALF_L, HALF_W, POCKETS, FOOT_SPOT, HEAD_SPOT } from './table.js';
import { groupOf } from './table.js';
import { onEight } from './rules.js';

const R = BALL_R;

function distPointSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

// 合法目标球编号
export function legalTargets(match, balls) {
  const nums = balls.map((b) => b.n);
  if (!match || match.mode === 'practice') return nums;
  const p = match.turn;
  const g = match.groups[p];
  if (g === null) return nums.filter((n) => n !== 8);
  if (onEight(match, p)) return nums.filter((n) => n === 8);
  return nums.filter((n) => groupOf(n) === g);
}

function pocketAim(p) {
  // 瞄准袋口内侧一点（角袋朝台心偏移），避免卡袋角
  const k = p.kind === 'corner' ? 0.035 : 0.02;
  const dx = -Math.sign(p.x), dz = -Math.sign(p.z);
  return { x: p.x + (p.kind === 'corner' ? dx * k : 0), z: p.z + dz * k };
}

// 评估母球 cue 对 (目标球, 袋口) 的击球方案；返回 null 表示不可行
export function evalShot(cue, balls, target, pocket) {
  const P = pocketAim(pocket);
  let dx = P.x - target.x, dz = P.z - target.z;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-6) return null;
  dx /= dl; dz /= dl;
  const gx = target.x - dx * 2 * R, gz = target.z - dz * 2 * R;
  if (Math.abs(gx) > HALF_L - R || Math.abs(gz) > HALF_W - R) return null;
  const cx = gx - cue.x, cz = gz - cue.z;
  const cl = Math.hypot(cx, cz);
  if (cl < 1e-6) return null;
  const cut = Math.acos(Math.max(-1, Math.min(1, (cx * dx + cz * dz) / cl)));
  if (cut > (72 * Math.PI) / 180) return null;
  for (const b of balls) {
    if (b.n === target.n) continue;
    if (distPointSeg(b.x, b.z, cue.x, cue.z, gx, gz) < 2 * R * 0.98) return null;
    if (distPointSeg(b.x, b.z, target.x, target.z, P.x, P.z) < 2 * R * 0.98) return null;
  }
  const score = cut * 2.0 + cl * 0.5 + dl * 0.8;
  return { angle: Math.atan2(cz, cx), cut, cueDist: cl, potDist: dl, score, pocket: pocket.id, ball: target.n };
}

// 选一杆。cue: {x,z}；balls: 目标球 [{n,x,z}]（不含母球）
// noiseScale：放大角度误差（简单难度用）；sloppy：有多大概率不选最优线而随机选前几条（简单 / 普通会“看走眼”）
export function pickShot({ cue, balls, match, rng, skill = 0.7, breaking = false, noiseScale = 1, sloppy = 0 }) {
  const noise = (1 - skill) * 0.022 * noiseScale;
  const jitter = () => (rng ? rng.gauss() : 0) * noise;
  if (breaking) {
    const apex = balls.reduce((a, b) => (a && a.x < b.x ? a : b), null);
    const aim = apex || FOOT_SPOT;
    return {
      angle: Math.atan2(aim.z - cue.z, aim.x - cue.x) + jitter() * 0.5,
      power: 0.92, spinX: 0, spinY: 0.1, kind: 'break',
    };
  }
  const legal = new Set(legalTargets(match, balls));
  let best = null; const cands = [];
  for (const t of balls) {
    if (!legal.has(t.n)) continue;
    for (const p of POCKETS) {
      const s = evalShot(cue, balls, t, p);
      if (s) { cands.push(s); if (!best || s.score < best.score) best = s; }
    }
  }
  if (best && sloppy > 0 && rng && cands.length > 1 && rng() < sloppy) {
    cands.sort((a, b) => a.score - b.score);
    best = cands[Math.min(cands.length - 1, Math.floor(rng() * Math.min(4, cands.length)))];
  }
  if (best) {
    const total = best.cueDist + best.potDist;
    const power = Math.max(0.22, Math.min(0.85, 0.22 + total * 0.26 + (rng ? rng.gauss() * (1 - skill) * 0.06 * noiseScale : 0)));
    // 小切角随点高杆，大切角随点低杆，保持走位
    const spinY = best.cut < 0.2 ? 0.0 : -0.1;
    return { angle: best.angle + jitter(), power, spinX: 0, spinY, kind: 'pot', ball: best.ball, pocket: best.pocket };
  }
  // 没有可打的进攻线：直接打最近的合法球（解斯诺克/防守）
  let near = null, nd = Infinity;
  for (const t of balls) {
    if (!legal.has(t.n)) continue;
    const d = Math.hypot(t.x - cue.x, t.z - cue.z);
    if (d < nd) { nd = d; near = t; }
  }
  if (!near) near = balls[0] || FOOT_SPOT;
  return {
    angle: Math.atan2(near.z - cue.z, near.x - cue.x) + jitter(),
    power: 0.45, spinX: 0, spinY: 0, kind: 'safety', ball: near.n,
  };
}

// 自由球摆放：开球时放在头弦后；否则找一个“最佳进攻位”
export function pickPlacement({ balls, match, breaking = false }) {
  if (breaking) return { x: HEAD_SPOT.x, z: 0 };
  const legal = new Set(legalTargets(match, balls));
  let best = null;
  for (let x = -HALF_L + 0.15; x <= HALF_L - 0.15; x += 0.12) {
    for (let z = -HALF_W + 0.12; z <= HALF_W - 0.12; z += 0.1) {
      if (balls.some((b) => Math.hypot(b.x - x, b.z - z) < 2 * R + 0.02)) continue;
      if (POCKETS.some((p) => Math.hypot(p.x - x, p.z - z) < p.capture + R + 0.02)) continue;
      for (const t of balls) {
        if (!legal.has(t.n)) continue;
        for (const p of POCKETS) {
          const s = evalShot({ x, z }, balls, t, p);
          if (s && (!best || s.score < best.score)) best = { x, z, score: s.score };
        }
      }
    }
  }
  return best ? { x: best.x, z: best.z } : { x: HEAD_SPOT.x, z: 0 };
}
