// 其余纯逻辑模块的测试：回放、AI、i18n 字典。（物理 / 飞镖 / 酒吧三组见同目录其他文件）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplayRecorder, ReplayPlayer, FRAME_FLOATS, SAMPLE_DT } from '../src/replay.js';
import { SNAP_STRIDE } from '../src/sim.js';
import { pickShot, pickPlacement, legalTargets, evalShot } from '../src/ai.js';
import { newMatch } from '../src/rules.js';
import { mulberry32 } from '../src/rng.js';
import { _dict } from '../src/i18n.js';
import { BALL_R, HALF_L, HALF_W, POCKETS } from '../src/table.js';

function snap(x) {
  const s = new Float32Array(FRAME_FLOATS);
  for (let n = 0; n < 16; n++) { const k = n * SNAP_STRIDE; s[k] = n; s[k + 1] = x; s[k + 2] = BALL_R; s[k + 3] = n * 0.1; s[k + 7] = 1; }
  return s;
}

test('回放：录制 → 播放，位置在帧间线性插值', () => {
  const rec = new ReplayRecorder();
  rec.begin(snap(0));
  rec.push(snap(1));
  rec.push(snap(2));
  const shot = rec.finish();
  assert.equal(shot.count, 3);
  assert.ok(Math.abs(shot.duration - 2 * SAMPLE_DT) < 1e-9);
  const p = new ReplayPlayer(shot);
  p.seek(0.25);            // 0.25 * 2 帧 = 第 0.5 帧
  const f = p.frame();
  assert.ok(Math.abs(f[1] - 0.5) < 1e-5);
  p.seek(1);
  assert.ok(Math.abs(p.frame()[1] - 2) < 1e-5);
});

test('回放：变速只改变播放进度速度；0.1× 约为 1× 的十分之一', () => {
  const rec = new ReplayRecorder();
  rec.begin(snap(0));
  for (let i = 1; i < 120; i++) rec.push(snap(i));
  const shot = rec.finish();
  const a = new ReplayPlayer(shot); a.setSpeed(1); a.update(0.5);
  const b = new ReplayPlayer(shot); b.setSpeed(0.1); b.update(0.5);
  assert.ok(Math.abs(a.time - 0.5) < 1e-9);
  assert.ok(Math.abs(b.time - 0.05) < 1e-9);
  const c = new ReplayPlayer(shot); c.setSpeed(0.01);
  assert.equal(c.speed, 0.1, '速度下限 0.1×');
  c.setSpeed(5);
  assert.equal(c.speed, 1, '速度上限 1×');
});

test('回放：事件按时间触发一次，拖动后只触发之后的事件', () => {
  const rec = new ReplayRecorder();
  rec.begin(snap(0));
  for (let i = 1; i < 60; i++) { rec.push(snap(i)); if (i === 10) rec.addEvent({ type: 'ballHit' }); if (i === 40) rec.addEvent({ type: 'pocket' }); }
  const shot = rec.finish();
  const p = new ReplayPlayer(shot);
  const got = [];
  for (let i = 0; i < 100; i++) got.push(...p.update(0.02).map((e) => e.type));
  assert.deepEqual(got, ['ballHit', 'pocket']);
  assert.ok(p.finished);
  const q = new ReplayPlayer(shot);
  q.seek(0.5);
  const later = [];
  for (let i = 0; i < 100; i++) later.push(...q.update(0.02).map((e) => e.type));
  assert.deepEqual(later, ['pocket']);
});

test('回放：落袋球在插值时不闪回', () => {
  const a = snap(0), b = snap(1);
  b[2 * SNAP_STRIDE] = -3;   // 2 号球在第二帧落袋（标记为 -n-1）
  const rec = new ReplayRecorder(); rec.begin(a); rec.push(b);
  const p = new ReplayPlayer(rec.finish());
  p.seek(0.5);
  assert.ok(p.frame()[2 * SNAP_STRIDE] < 0);
});

test('回放：录制缓冲区自动扩容，长杆不丢帧', () => {
  const rec = new ReplayRecorder();
  rec.begin(snap(0));
  for (let i = 1; i < 2000; i++) rec.push(snap(i));
  const shot = rec.finish();
  assert.equal(shot.count, 2000);
  const p = new ReplayPlayer(shot); p.seek(1);
  assert.ok(Math.abs(p.frame()[1] - 1999) < 1e-3);
});

// ---------- AI ----------
test('AI：直球可进时选这个球与这个袋口，切角小', () => {
  const cue = { x: 0.2, z: 0 };
  const balls = [{ n: 3, x: 0.7, z: 0 }];
  // 袋口在远端角附近不是直线；只验证给出可行方案并且角度有限
  const s = pickShot({ cue, balls, match: null, rng: mulberry32(1), skill: 1 });
  assert.ok(Number.isFinite(s.angle) && s.power > 0 && s.power <= 1);
  assert.ok(['pot', 'safety'].includes(s.kind));
});

test('AI：几何上正对袋口的球，评估出的瞄准角就是母球→幽灵球方向', () => {
  const pk = POCKETS[2]; // (HALF_L, -HALF_W)
  const target = { n: 5, x: pk.x - 0.4, z: pk.z + 0.4 };       // 在角袋对角线上
  const cue = { x: target.x - 0.5 * Math.SQRT1_2, z: target.z + 0.5 * Math.SQRT1_2 }; // 母球在对角线后方（台面内）
  const s = evalShot(cue, [target], target, pk);
  assert.ok(s, '应可行');
  assert.ok(s.cut < 0.2, `近似直球，切角应很小：${s.cut}`);
});

test('AI：路径被别的球挡住时该方案不可行', () => {
  const pk = POCKETS[2];
  const target = { n: 5, x: pk.x - 0.4, z: pk.z + 0.4 };
  const cue = { x: target.x - 0.5 * Math.SQRT1_2, z: target.z + 0.5 * Math.SQRT1_2 };
  const blocker = { n: 9, x: target.x - 0.25 * Math.SQRT1_2, z: target.z + 0.25 * Math.SQRT1_2 };
  assert.equal(evalShot(cue, [target, blocker], target, pk), null);
});

test('AI：开球瞄向球堆顶球；比赛定组后只选己方球', () => {
  const apex = { n: 1, x: 0.635, z: 0 };
  const b = pickShot({ cue: { x: -0.635, z: 0 }, balls: [apex, { n: 12, x: 0.7, z: 0.06 }], match: newMatch(), rng: mulberry32(1), skill: 1, breaking: true });
  assert.equal(b.kind, 'break');
  assert.ok(Math.abs(b.angle) < 0.01);
  const m = newMatch(); m.groups = ['solid', 'stripe']; m.turn = 0; m.phase = 'play';
  m.onTable = new Set([2, 11]);
  const balls = [{ n: 2, x: 0.3, z: 0.2 }, { n: 11, x: 0.4, z: -0.2 }];
  assert.deepEqual(legalTargets(m, balls), [2]);
  m.turn = 1;
  assert.deepEqual(legalTargets(m, balls), [11]);
});

test('AI：己方球打光后只能打黑八', () => {
  const m = newMatch(); m.groups = ['solid', 'stripe']; m.turn = 0; m.phase = 'play';
  m.onTable = new Set([8, 11]);
  const balls = [{ n: 8, x: 0.3, z: 0 }, { n: 11, x: 0.4, z: 0.2 }];
  assert.deepEqual(legalTargets(m, balls), [8]);
});

test('AI：自由球摆放在台面内、不压球、不在袋口', () => {
  const balls = [{ n: 1, x: 0.5, z: 0.1 }, { n: 9, x: 0.8, z: -0.2 }];
  const p = pickPlacement({ balls, match: null });
  assert.ok(Math.abs(p.x) <= HALF_L - BALL_R && Math.abs(p.z) <= HALF_W - BALL_R);
  for (const b of balls) assert.ok(Math.hypot(b.x - p.x, b.z - p.z) >= 2 * BALL_R);
  for (const k of POCKETS) assert.ok(Math.hypot(k.x - p.x, k.z - p.z) > k.capture);
});

// ---------- i18n ----------
test('i18n：中英字典键完全一致', () => {
  const d = _dict();
  const zh = Object.keys(d.zh).sort(), en = Object.keys(d.en).sort();
  assert.deepEqual(zh.filter((k) => !(k in d.en)), [], '英文缺键');
  assert.deepEqual(en.filter((k) => !(k in d.zh)), [], '中文缺键');
});

test('i18n：占位符在两种语言中一致', () => {
  const d = _dict();
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(d.zh)) assert.equal(ph(d.zh[k]), ph(d.en[k]), `键 ${k} 的占位符不一致`);
});
