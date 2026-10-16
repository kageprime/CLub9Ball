import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD, SECTORS, THROW_DIST, BOARD_CENTER_Y, G,
  scoreAt, solveLaunch, flyToBoard, DartsGame,
} from '../src/darts.js';

const mid = (a, b) => (a + b) / 2;

test('镖盘：20 个分区，顺序符合标准，和为 210', () => {
  assert.equal(SECTORS.length, 20);
  assert.equal(new Set(SECTORS).size, 20);
  assert.equal(SECTORS.reduce((a, b) => a + b, 0), 210);
  assert.equal(SECTORS[0], 20);
  assert.deepEqual(SECTORS.slice(0, 5), [20, 1, 18, 4, 13]);
});

test('计分：红心 50、外环 25、脱靶 0', () => {
  assert.deepEqual(scoreAt(0, 0).score, 50);
  assert.equal(scoreAt(0, 0).ring, 'bull');
  assert.equal(scoreAt(0, mid(BOARD.bull, BOARD.outerBull)).score, 25);
  assert.equal(scoreAt(0, BOARD.doubleOut + 0.01).score, 0);
  assert.equal(scoreAt(0.3, 0.3).ring, 'miss');
});

test('计分：正上方 20 区的单倍 / 三倍 / 双倍', () => {
  assert.equal(scoreAt(0, 0.06).score, 20);
  assert.equal(scoreAt(0, mid(BOARD.trebleIn, BOARD.trebleOut)).score, 60);
  assert.equal(scoreAt(0, mid(BOARD.doubleIn, BOARD.doubleOut)).score, 40);
  assert.equal(scoreAt(0, 0.135).score, 20, '三倍环与双倍环之间是单倍');
});

test('计分：所有 20 个扇区的方位正确（右为 6，下为 3，左为 11）', () => {
  const r = 0.06;
  for (let i = 0; i < 20; i++) {
    const th = (i * Math.PI) / 10;              // 从正上方顺时针
    const x = r * Math.sin(th), y = r * Math.cos(th);
    assert.equal(scoreAt(x, y).sector, SECTORS[i], `扇区 ${i}`);
  }
  assert.equal(scoreAt(r, 0).sector, 6);
  assert.equal(scoreAt(0, -r).sector, 3);
  assert.equal(scoreAt(-r, 0).sector, 11);
});

test('计分：扇区边界两侧归属不同（20 与 1 之间 9°）', () => {
  const r = 0.06;
  const a = (deg) => ({ x: r * Math.sin((deg * Math.PI) / 180), y: r * Math.cos((deg * Math.PI) / 180) });
  assert.equal(scoreAt(a(8.9).x, a(8.9).y).sector, 20);
  assert.equal(scoreAt(a(9.1).x, a(9.1).y).sector, 1);
  assert.equal(scoreAt(a(-8.9).x, a(-8.9).y).sector, 20);
  assert.equal(scoreAt(a(-9.1).x, a(-9.1).y).sector, 5);
});

test('弹道求解：把解代回飞行方程，落点精确命中目标', () => {
  const from = { x: 0.1, y: 1.75, z: THROW_DIST };
  for (const [tx, ty] of [[0, 0], [0.05, 0.1], [-0.12, -0.08], [0.0, 0.103]]) {
    const target = { x: tx, y: BOARD_CENTER_Y + ty, z: 0 };
    const sol = solveLaunch(from, target, 13);
    assert.ok(sol, '应有解');
    const land = flyToBoard(from, 13, sol.pitch, sol.yaw);
    assert.ok(Math.abs(land.x - tx) < 1e-9, `x 偏差 ${land.x - tx}`);
    assert.ok(Math.abs(land.y - ty) < 1e-9, `y 偏差 ${land.y - ty}`);
    assert.ok(Math.abs(land.t - sol.time) < 1e-9);
  }
});

test('弹道求解：低弧比高弧飞得快；速度太小则无解', () => {
  const from = { x: 0, y: 1.75, z: THROW_DIST };
  const target = { x: 0, y: BOARD_CENTER_Y, z: 0 };
  const sol = solveLaunch(from, target, 13);
  assert.ok(sol.time < sol.high.time);
  assert.ok(sol.pitch < sol.high.pitch);
  assert.equal(solveLaunch(from, target, 2), null);
});

test('弹道：出手略低于瞄准点时飞镖会下坠（重力）', () => {
  const from = { x: 0, y: 1.75, z: THROW_DIST };
  // 平射（pitch = 0）：下坠量 = ½ g t²
  const land = flyToBoard(from, 13, 0, 0);
  const t = THROW_DIST / 13;
  assert.ok(Math.abs(land.y - (1.75 - BOARD_CENTER_Y - 0.5 * G * t * t)) < 1e-9);
});

test('三镖一轮：满三镖才结算，轮分与总分正确', () => {
  const game = new DartsGame({ seed: 1, skill: 1 });
  let r = game.throwDart({ x: 0, y: 0 }, { power: 0.5 });
  assert.equal(r.roundDone, false);
  r = game.throwDart({ x: 0, y: 0 }, { power: 0.5 });
  assert.equal(r.roundDone, false);
  r = game.throwDart({ x: 0, y: 0 }, { power: 0.5 });
  assert.equal(r.roundDone, true);
  assert.equal(game.rounds.length, 1);
  assert.equal(game.total, game.rounds[0]);
  assert.equal(game.round.length, 0);
});

test('确定性：同一种子 → 同样的投掷结果', () => {
  const run = () => {
    const g = new DartsGame({ seed: 42, skill: 0.5 });
    return Array.from({ length: 9 }, () => g.throwDart({ x: 0, y: 0.1 }).score).join();
  };
  assert.equal(run(), run());
});

test('技术越高，平均落点越靠近瞄准点', () => {
  const spread = (skill) => {
    const g = new DartsGame({ seed: 7, skill });
    let sum = 0;
    for (let i = 0; i < 400; i++) {
      const d = g.throwDart({ x: 0, y: 0 }, { power: 0.5 });
      sum += Math.hypot(d.x, d.y);
    }
    return sum / 400;
  };
  assert.ok(spread(1) < spread(0.2));
});

test('180 徽章：三镖都在 20 区三倍环才触发', () => {
  // 预置前两镖为 T20，第三镖瞄准 T20 中心。技术满值时 σ≈3.5 mrad（2.37 m 处约 8 mm），
  // 三倍环只有 8 mm 宽，所以个别种子会不中——扫描种子，找到命中的那个来验证徽章逻辑。
  const mid20 = (BOARD.trebleIn + BOARD.trebleOut) / 2;
  let got = false;
  for (let seed = 1; seed < 200 && !got; seed++) {
    const g = new DartsGame({ seed, skill: 1 });
    g.round = [
      { ring: 'treble', sector: 20, score: 60 },
      { ring: 'treble', sector: 20, score: 60 },
    ];
    const r = g.throwDart({ x: 0, y: mid20 }, { power: 0.5 });
    if (r.ring === 'treble' && r.sector === 20) {
      assert.equal(r.roundScore, 180);
      assert.ok(g.badges.has('180'));
      assert.ok(r.events.some((e) => e.type === 'badge' && e.id === '180'));
      got = true;
    }
  }
  assert.ok(got, '在 200 个种子内应至少有一次第三镖命中 T20');
});

test('180 徽章：第三镖脱靶则总分不是 180，不给徽章', () => {
  const g = new DartsGame({ seed: 3, skill: 1 });
  g.round = [
    { ring: 'treble', sector: 20, score: 60 },
    { ring: 'treble', sector: 20, score: 60 },
  ];
  const r = g.throwDart({ x: 0, y: -0.2 });   // 故意瞄到盘外下方
  assert.notEqual(r.roundScore, 180);
  assert.ok(!g.badges.has('180'));
});
