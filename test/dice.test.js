// 骰子扑克：牌型 / 比牌 / 庄家策略（纯逻辑）+ 托盘物理（需要 Rapier）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRapier } from './_rapier.js';
import { rankHand, compareHands, houseHolds, playHouse, quatFaceUp, DiceTray, TRAY, rackX, PAYOUT, HANDS } from '../src/dice.js';
import { topFace } from '../src/bar.js';
import { mulberry32 } from '../src/rng.js';

const RAPIER = await loadRapier();
const needRapier = { skip: RAPIER ? false : '未安装 @dimforge/rapier3d-compat（先 npm install）' };

test('牌型：八种牌型都能识别', () => {
  const k = (f) => rankHand(f).kind;
  assert.equal(k([6, 6, 6, 6, 6]), 'five');
  assert.equal(k([2, 2, 2, 2, 5]), 'four');
  assert.equal(k([3, 3, 3, 4, 4]), 'fullHouse');
  assert.equal(k([1, 2, 3, 4, 5]), 'straight');
  assert.equal(k([6, 2, 3, 4, 5]), 'straight');
  assert.equal(k([4, 4, 4, 1, 6]), 'trips');
  assert.equal(k([1, 1, 5, 5, 3]), 'twoPair');
  assert.equal(k([2, 2, 4, 5, 6]), 'pair');
  assert.equal(k([1, 2, 3, 4, 6]), 'high');          // 差一张的顺子不算
  assert.equal(k([1, 3, 4, 5, 6]), 'high');
});

test('比牌：牌型高者胜；同牌型比大小；完全相同平局', () => {
  assert.equal(compareHands([2, 2, 2, 2, 5], [6, 6, 6, 5, 5]), 'win');          // 四条 > 葫芦
  assert.equal(compareHands([1, 2, 3, 4, 5], [2, 3, 4, 5, 6]), 'lose');        // 顺子比最大点
  assert.equal(compareHands([6, 6, 1, 2, 3], [5, 5, 6, 4, 3]), 'win');         // 一对 6 > 一对 5
  assert.equal(compareHands([4, 4, 3, 1, 2], [4, 4, 3, 1, 6]), 'lose');        // 同对，踢脚 2<6… 3,1,2 vs 3,1,6 → 比较 [4,3,2,1] vs [4,6,3,1]
  assert.equal(compareHands([5, 5, 2, 2, 1], [5, 5, 3, 3, 1]), 'lose');        // 两对：比第二对
  assert.equal(compareHands([3, 3, 3, 4, 4], [3, 3, 3, 4, 4]), 'push');
  assert.equal(compareHands([1, 3, 4, 5, 6], [2, 3, 4, 5, 6].map((v, i) => (i === 0 ? 1 : v))), 'push');
});

test('牌型顺序与奖金：越大越贵', () => {
  for (let i = 1; i < HANDS.length; i++) assert.ok(PAYOUT[HANDS[i]] >= PAYOUT[HANDS[i - 1]]);
  assert.equal(HANDS[HANDS.length - 1], 'five');
});

test('庄家策略：成牌全留；一对留对子；缺一张的顺子留四张', () => {
  assert.deepEqual(houseHolds([3, 3, 3, 4, 4]), [true, true, true, true, true]);
  assert.deepEqual(houseHolds([2, 5, 2, 1, 6]), [true, false, true, false, false]);
  const h = houseHolds([1, 2, 3, 4, 6]);                 // 1234 + 6：留 1234
  assert.deepEqual(h, [true, true, true, true, false]);
  const t = houseHolds([6, 6, 6, 1, 2]);
  assert.deepEqual(t, [true, true, true, false, false]);
});

test('庄家整局：最多 3 次投掷，点数在 1..6，种子确定', () => {
  const a = playHouse(mulberry32(5)), b = playHouse(mulberry32(5));
  assert.deepEqual(a, b);
  for (let s = 0; s < 200; s++) {
    const r = playHouse(mulberry32(s));
    assert.ok(r.rolls >= 1 && r.rolls <= 3 && r.history.length === r.rolls);
    assert.equal(r.faces.length, 5);
    assert.ok(r.faces.every((v) => v >= 1 && v <= 6));
  }
});

test('庄家策略 vs 随机乱留：策略的平均牌型不应更差', () => {
  const rng = mulberry32(2024);
  let hs = 0, rs = 0; const N = 600;
  for (let i = 0; i < N; i++) {
    hs += rankHand(playHouse(rng).faces).rank;
    let f = Array.from({ length: 5 }, () => rng.int(1, 6));
    for (let r = 0; r < 2; r++) f = f.map((v) => (rng() < 0.5 ? v : rng.int(1, 6)));
    rs += rankHand(f).rank;
  }
  assert.ok(hs / N > rs / N, `策略 ${hs / N} 应大于乱投 ${rs / N}`);
});

test('quatFaceUp：任意点数朝上后 topFace 读回同一点数', () => {
  for (let f = 1; f <= 6; f++) for (const yaw of [0, 1.2, -2]) {
    const r = topFace(quatFaceUp(f, yaw));
    assert.equal(r.face, f);
    assert.ok(r.flat > 0.9999);
  }
});

test('托盘：首投 5 颗落平归位到骰架，点数 1..6，槽位按升序', needRapier, () => {
  const tray = new DiceTray(RAPIER, { seed: 3 });
  assert.equal(tray.throwDice([0, 1, 2, 3, 4]), true);
  tray.run();
  assert.equal(tray.phase, 'ready');
  assert.ok(tray.faces.every((v) => v >= 1 && v <= 6), JSON.stringify(tray.faces));
  assert.deepEqual([...tray.faces].sort((a, b) => a - b), tray.faces);
  const s = tray.snapshot();
  s.forEach((d, k) => { assert.ok(Math.abs(d.x - rackX(k)) < 1e-6); assert.ok(Math.abs(d.z - TRAY.rackZ) < 1e-6); });
  tray.dispose();
});

test('托盘：留骰不变，只重投没留的；总共可多次', needRapier, () => {
  const tray = new DiceTray(RAPIER, { seed: 8 });
  tray.throwDice([0, 1, 2, 3, 4]); tray.run();
  const before = [...tray.faces];
  tray.toggleHold(0); tray.toggleHold(1);
  assert.equal(tray.throwDice(), true);
  assert.equal(tray.rollNo, 2);
  tray.run();
  assert.equal(tray.faces[0], before[0]);
  assert.equal(tray.faces[1], before[1]);
  assert.ok(tray.faces.every((v) => v >= 1 && v <= 6));
  assert.equal(tray.throwDice([]), false);
  tray.dispose();
});

test('托盘：投掷中不能留骰 / 重投；全留时没有可投', needRapier, () => {
  const tray = new DiceTray(RAPIER, { seed: 1 });
  tray.throwDice([0, 1, 2, 3, 4]);
  assert.equal(tray.toggleHold(0), false);
  assert.equal(tray.throwDice(), false);
  tray.run();
  for (let i = 0; i < 5; i++) tray.toggleHold(i);
  assert.equal(tray.throwDice(), false);
  tray.dispose();
});

test('托盘：200 次投掷点数大致均匀（每面 12%–22%），没有卡在半空的骰子', needRapier, () => {
  const cnt = [0, 0, 0, 0, 0, 0, 0]; let n = 0;
  for (let s = 0; s < 40; s++) {
    const tray = new DiceTray(RAPIER, { seed: 100 + s });
    tray.throwDice([0, 1, 2, 3, 4]); tray.run();
    assert.equal(tray.phase, 'ready', `seed ${100 + s} 未完成`);
    for (const f of tray.faces) { cnt[f]++; n++; }
    tray.dispose();
  }
  for (let f = 1; f <= 6; f++) assert.ok(cnt[f] / n > 0.1 && cnt[f] / n < 0.25, `点数 ${f}: ${(cnt[f] / n).toFixed(3)}`);
});
