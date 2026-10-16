import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRapier } from './_rapier.js';
import { Chips, Roulette, DiceWorld, topFace, compareDice, settleDice } from '../src/bar.js';

const RAPIER = await loadRapier();
const needRapier = { skip: RAPIER ? false : '未安装 @dimforge/rapier3d-compat（先 npm install）' };

// ---------- 筹码 ----------
test('筹码：下注扣款、不够不能下、赢回双倍、平局退还', () => {
  const c = new Chips(100);
  assert.equal(c.bet(30), true);
  assert.equal(c.balance, 70);
  assert.equal(c.bet(100), false);
  assert.equal(c.balance, 70);
  assert.equal(settleDice(c, 30, 'win'), 130);
  const d = new Chips(100); d.bet(20);
  assert.equal(settleDice(d, 20, 'push'), 100);
  const e = new Chips(100); e.bet(20);
  assert.equal(settleDice(e, 20, 'lose'), 80);
});

test('比大小：大者胜，相等平局', () => {
  assert.equal(compareDice(12, 9), 'win');
  assert.equal(compareDice(7, 9), 'lose');
  assert.equal(compareDice(9, 9), 'push');
});

// ---------- 骰子读数（纯数学） ----------
const qAxis = (ax, ay, az, deg) => {
  const h = (deg * Math.PI) / 360, s = Math.sin(h);
  const n = Math.hypot(ax, ay, az);
  return { x: (ax / n) * s, y: (ay / n) * s, z: (az / n) * s, w: Math.cos(h) };
};

test('骰子读数：未旋转时朝上是 1；各个翻面读数正确且对面和为 7', () => {
  assert.equal(topFace({ x: 0, y: 0, z: 0, w: 1 }).face, 1);
  const up = (q) => topFace(q).face;
  assert.equal(up(qAxis(0, 0, 1, 180)), 6);   // 翻 180° → −y 朝上
  assert.equal(up(qAxis(0, 0, 1, 90)), 2);    // 绕 z 转 +90°：局部 +x 轴转到朝上
  assert.equal(up(qAxis(0, 0, 1, -90)), 5);   // 绕 z 转 −90°：局部 −x 轴朝上
  assert.equal(up(qAxis(1, 0, 0, 90)), 4);
  assert.equal(up(qAxis(1, 0, 0, -90)), 3);
  assert.ok(topFace(qAxis(0, 1, 0, 33)).flat > 0.999, '绕竖直轴转动不影响读数与平整度');
  for (const [a, b] of [[1, 6], [2, 5], [3, 4]]) assert.equal(a + b, 7);
});

test('骰子读数：斜靠姿态的平整度明显小于 1', () => {
  const q = qAxis(0, 0, 1, 45);
  assert.ok(topFace(q).flat < 0.8);
});

// ---------- 轮盘 ----------
test('轮盘：不转轮连扣扳机，6 次内必定响一次且只响一次', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const r = new Roulette({ seed });
    let bangs = 0, pulls = 0;
    while (!r.over && pulls < 6) { if (r.pull().bang) bangs++; pulls++; }
    assert.equal(bangs, 1, `种子 ${seed}`);
    assert.ok(pulls <= 6);
    assert.equal(r.over, true);
  }
});

test('轮盘：响过之后局终，再扣不再触发', () => {
  const r = new Roulette({ seed: 5 });
  while (!r.over) r.pull();
  const again = r.pull();
  assert.equal(again.bang, false);
  assert.equal(again.over, true);
});

test('轮盘：确定性（同种子同结果），换种子结果会变', () => {
  const seq = (seed) => { const r = new Roulette({ seed }); let n = 0; while (!r.over) { r.pull(); n++; } return n; };
  assert.equal(seq(11), seq(11));
  const set = new Set(Array.from({ length: 30 }, (_, i) => seq(i + 1)));
  assert.ok(set.size > 1, '不同种子应出现不同的响枪次序');
});

test('轮盘：每个位置的中弹概率大致均匀（6 个位置各约 1/6）', () => {
  const counts = new Array(6).fill(0);
  const N = 6000;
  const r = new Roulette({ seed: 2024 });
  for (let i = 0; i < N; i++) {
    r.spin();
    let k = 0;
    while (!r.over) { const res = r.pull(); if (res.bang) counts[k]++; k++; }
    r.over = false;
  }
  for (const c of counts) assert.ok(Math.abs(c / N - 1 / 6) < 0.025, `分布偏差过大：${counts}`);
});

test('轮盘：公平赔率与安全概率', () => {
  const r = new Roulette({ seed: 1 });
  assert.ok(Math.abs(r.safeOdds() - 5 / 6) < 1e-12);
  assert.equal(r.multiplier(), 1);
  r.pos = (r.bullet + 3) % 6; // 保证前几次安全
  r.pull();
  assert.ok(Math.abs(r.safeOdds() - 4 / 5) < 1e-12);
  assert.ok(Math.abs(r.multiplier() - 6 / 5) < 1e-12);
});

// ---------- 骰盅 Rapier 小世界 ----------
test('骰盅：摇、倒、停后读出 1–6 点，骰子落在桌面上', needRapier, () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const w = new DiceWorld(RAPIER, { seed, count: 3 });
    const res = w.run(15);
    assert.equal(w.phase, 'done');
    assert.equal(res.length, 3);
    for (const d of res) {
      assert.ok(d.face >= 1 && d.face <= 6, `点数 ${d.face}`);
      assert.ok(d.y < 0.05, `骰子应落在桌面：y=${d.y}`);
    }
    assert.ok(w.total() >= 3 && w.total() <= 18);
    w.dispose();
  }
});

test('骰盅：同种子结果一致（确定性），不同种子分布出多种点数', needRapier, () => {
  const roll = (seed) => { const w = new DiceWorld(RAPIER, { seed }); const t = w.run(15).map((d) => d.face).join(''); w.dispose(); return t; };
  assert.equal(roll(8), roll(8));
  const set = new Set(Array.from({ length: 12 }, (_, i) => roll(i + 20)));
  assert.ok(set.size > 4, '12 次摇骰应出现多种组合');
});
