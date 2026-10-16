// 飞镖：标准 20 分区镖盘 + 弹道求解器 + 三镖一轮。纯逻辑，不依赖 DOM / Rapier。
// 坐标系：镖盘平面 z = 0，x 向右，y 向上；投掷者在 z = +THROW_DIST，朝 -z 方向投。

import { mulberry32 } from './rng.js';

export const BOARD = {
  bull: 0.00635,          // 红心半径（12.7 mm 直径）
  outerBull: 0.0159,      // 外环（25 分）
  trebleIn: 0.099, trebleOut: 0.107,
  doubleIn: 0.162, doubleOut: 0.170,
  face: 0.2255,           // 数字环外沿（用于渲染）
};
export const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const THROW_DIST = 2.37;     // 标准投掷线到镖盘 2.37 m
export const BOARD_CENTER_Y = 1.73; // 红心离地 1.73 m
export const G = 9.81;

// 按落点算分。x,y 相对红心（米）。
export function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= BOARD.bull) return { score: 50, ring: 'bull', sector: 25, mult: 2 };
  if (r <= BOARD.outerBull) return { score: 25, ring: 'outerBull', sector: 25, mult: 1 };
  if (r > BOARD.doubleOut) return { score: 0, ring: 'miss', sector: 0, mult: 0 };
  let th = Math.atan2(x, y);            // 从正上方（20）顺时针
  if (th < 0) th += 2 * Math.PI;
  const idx = Math.floor(((th + Math.PI / 20) % (2 * Math.PI)) / (Math.PI / 10));
  const sector = SECTORS[idx];
  let ring = 'single', mult = 1;
  if (r >= BOARD.trebleIn && r <= BOARD.trebleOut) { ring = 'treble'; mult = 3; }
  else if (r >= BOARD.doubleIn) { ring = 'double'; mult = 2; }
  return { score: sector * mult, ring, sector, mult };
}

// 弹道求解：已知起点、目标点、出手速度，求低弧发射角。
// from/target: {x,y,z}；返回 { pitch, yaw, time, high:{pitch,time} } 或 null（够不着）。
export function solveLaunch(from, target, speed, g = G) {
  const dx = target.x - from.x, dz = target.z - from.z, dy = target.y - from.y;
  const d = Math.hypot(dx, dz);
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  if (disc < 0 || d < 1e-9) return null;
  const root = Math.sqrt(disc);
  const pLow = Math.atan2(v2 - root, g * d);
  const pHigh = Math.atan2(v2 + root, g * d);
  const yaw = Math.atan2(dx, -dz);       // 0 = 正对 -z，正值偏向 +x
  const tof = (p) => d / (speed * Math.cos(p));
  return { pitch: pLow, yaw, time: tof(pLow), high: { pitch: pHigh, time: tof(pHigh) } };
}

// 给定出手参数，飞行到镖盘平面 z = 0，返回落点（相对红心）与飞行时间。
export function flyToBoard(from, speed, pitch, yaw, g = G) {
  const vx = speed * Math.cos(pitch) * Math.sin(yaw);
  const vy = speed * Math.sin(pitch);
  const vz = -speed * Math.cos(pitch) * Math.cos(yaw);
  if (vz >= 0) return null;
  const t = -from.z / vz;
  const x = from.x + vx * t;
  const y = from.y + vy * t - 0.5 * g * t * t;
  return { x, y: y - BOARD_CENTER_Y, t };
}

export class DartsGame {
  constructor({ seed = 180, speed = 13, perRound = 3, skill = 0.55 } = {}) {
    this.rng = mulberry32(seed);
    this.speed = speed;           // 出手速度（m/s）
    this.perRound = perRound;
    this.skill = skill;           // 0..1，越高越稳
    this.from = { x: 0, y: 1.75, z: THROW_DIST };
    this.reset();
  }

  reset() {
    this.round = [];              // 当前轮的飞镖
    this.rounds = [];             // 已完成轮的总分
    this.total = 0;
    this.badges = new Set();
  }

  // 瞄准点（相对红心，米）→ 投出一镖。power 可选 0..1：越接近 0.5 越稳（过猛/过软增加误差）。
  // 返回 { x, y, score, ring, sector, roundDone, roundScore, events }
  throwDart(aim, { power = 0.5, wobble = 0 } = {}) {
    const events = [];
    const target = { x: aim.x, y: BOARD_CENTER_Y + aim.y, z: 0 };
    const sol = solveLaunch(this.from, target, this.speed);
    let landing;
    if (!sol) {
      landing = { x: aim.x, y: aim.y - 0.5, t: 0.3 };
    } else {
      // 抖动：随机角误差，σ 随技术、力度偏离、手抖变化
      const sigma = (0.0035 + (1 - this.skill) * 0.012) * (1 + Math.abs(power - 0.5) * 3) + wobble;
      const dyaw = this.rng.gauss() * sigma;
      const dpit = this.rng.gauss() * sigma;
      landing = flyToBoard(this.from, this.speed, sol.pitch + dpit, sol.yaw + dyaw);
      if (!landing) landing = { x: aim.x, y: aim.y - 0.5, t: 0.3 };
    }
    const sc = scoreAt(landing.x, landing.y);
    const dart = { x: landing.x, y: landing.y, ...sc };
    this.round.push(dart);
    events.push({ type: 'dart', ...dart });

    let roundDone = false, roundScore = 0;
    if (this.round.length >= this.perRound) {
      roundDone = true;
      roundScore = this.round.reduce((a, d) => a + d.score, 0);
      this.rounds.push(roundScore);
      this.total += roundScore;
      if (roundScore === 180 && this.round.every((d) => d.ring === 'treble' && d.sector === 20)) {
        this.badges.add('180');
        events.push({ type: 'badge', id: '180' });
      }
      events.push({ type: 'roundEnd', score: roundScore, total: this.total });
      this.round = [];
    }
    return { ...dart, roundDone, roundScore, events };
  }

  roundSoFar() { return this.round.reduce((a, d) => a + d.score, 0); }
}
