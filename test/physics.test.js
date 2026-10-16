import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRapier } from './_rapier.js';
import { Sim, traceAim, rackLayout, SNAP_STRIDE } from '../src/sim.js';
import { newMatch, resolveShot, resolvePractice, detectFouls } from '../src/rules.js';
import { mulberry32 } from '../src/rng.js';
import { BALL_R, HALF_L, HALF_W, HEAD_SPOT, FOOT_SPOT } from '../src/table.js';

const RAPIER = await loadRapier();
const needRapier = { skip: RAPIER ? false : '未安装 @dimforge/rapier3d-compat（先 npm install）' };

// ---------- 纯函数（不需要 Rapier） ----------

test('球堆：15 球、互不重叠、8 号在中心、后排两角一实一花', () => {
  const L = rackLayout(mulberry32(9));
  assert.equal(L.length, 15);
  assert.equal(new Set(L.map((s) => s.n)).size, 15);
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const d = Math.hypot(L[i].x - L[j].x, L[i].z - L[j].z);
      assert.ok(d >= 2 * BALL_R, `球 ${L[i].n} 与 ${L[j].n} 重叠：${d}`);
    }
  }
  assert.equal(L[4].n, 8);
  assert.ok(L[10].n < 8 && L[14].n > 8);
  assert.ok(Math.abs(L[0].x - FOOT_SPOT.x) < 1e-9);
});

test('球堆：同一种子每次相同（确定性）', () => {
  const a = rackLayout(mulberry32(9)).map((s) => s.n).join();
  const b = rackLayout(mulberry32(9)).map((s) => s.n).join();
  const c = rackLayout(mulberry32(10)).map((s) => s.n).join();
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('瞄准线：正中直线击球，幽灵球距离为 2R，目标球沿球心连线飞出', () => {
  const t = traceAim({ x: -0.6, z: 0 }, [{ n: 3, x: 0.3, z: 0 }], 0);
  assert.equal(t.hit.ball, 3);
  assert.ok(Math.abs(t.hit.ghost.x - (0.3 - 2 * BALL_R)) < 1e-9);
  assert.ok(Math.abs(t.hit.objDir.x - 1) < 1e-9);
  assert.ok(Math.hypot(t.hit.cueDir.x, t.hit.cueDir.z) < 1e-9, '正碰后母球应停住');
});

test('瞄准线：无球时反弹一次，终点落在库边', () => {
  const t = traceAim({ x: 0, z: 0 }, [], 0);
  assert.equal(t.hit, null);
  assert.equal(t.points.length, 3);
  assert.ok(Math.abs(t.points[1].x - (HALF_L - BALL_R)) < 1e-9);
});

// ---------- 规则 ----------

const rep = (o) => ({ firstContact: null, pocketed: [], railAfterContact: false, railHits: 0, ...o });

test('规则：开球后首个进球定组，并继续击球', () => {
  const m0 = newMatch();
  const { match, fouls, events } = resolveShot(m0, rep({ firstContact: 1, pocketed: [10], railAfterContact: true }));
  assert.deepEqual(fouls, []);
  assert.equal(match.groups[0], 'stripe');
  assert.equal(match.groups[1], 'solid');
  assert.equal(match.turn, 0);
  assert.ok(events.some((e) => e.type === 'groupAssigned'));
  assert.equal(match.scores[0], 1);
});

test('规则：不进球换人，不犯规则无自由球', () => {
  const { match } = resolveShot(newMatch(), rep({ firstContact: 1, railAfterContact: true }));
  assert.equal(match.turn, 1);
  assert.equal(match.ballInHand, false);
});

test('规则：母球落袋犯规 → 换人 + 自由球', () => {
  const { match, fouls } = resolveShot(newMatch(), rep({ firstContact: 1, pocketed: [0], railAfterContact: true }));
  assert.ok(fouls.includes('scratch'));
  assert.equal(match.turn, 1);
  assert.equal(match.ballInHand, true);
});

test('规则：空杆（未碰任何球）犯规', () => {
  const { fouls } = resolveShot(newMatch(), rep({}));
  assert.ok(fouls.includes('noContact'));
});

test('规则：定组后首碰对方球犯规；碰黑八也犯规（未清台）', () => {
  let { match } = resolveShot(newMatch(), rep({ firstContact: 1, pocketed: [2], railAfterContact: true })); // P0 全色
  assert.equal(match.groups[0], 'solid');
  assert.deepEqual(detectFouls(match, rep({ firstContact: 11, railAfterContact: true })), ['wrongBall']);
  assert.deepEqual(detectFouls(match, rep({ firstContact: 8, railAfterContact: true })), ['wrongBall']);
  assert.deepEqual(detectFouls(match, rep({ firstContact: 3, railAfterContact: true })), []);
});

test('规则：触球后无进球也无库边 → 犯规', () => {
  const m = resolveShot(newMatch(), rep({ firstContact: 1, pocketed: [2], railAfterContact: true })).match;
  assert.deepEqual(detectFouls(m, rep({ firstContact: 3 })), ['noRail']);
});

test('规则：开球时黑八落袋 → 重新摆回，不判负', () => {
  const { match, events } = resolveShot(newMatch(), rep({ firstContact: 1, pocketed: [8], railAfterContact: true }));
  assert.equal(match.winner, null);
  assert.ok(match.onTable.has(8));
  assert.ok(events.some((e) => e.type === 'eightRespot'));
});

function matchWithGroups(solidsLeft) {
  const m = newMatch();
  m.groups = ['solid', 'stripe'];
  m.phase = 'play';
  m.breakShot = false;
  m.onTable = new Set([8, ...solidsLeft, 9, 10]);
  return m;
}

test('规则：未清台就打进黑八 → 判负', () => {
  const m = matchWithGroups([3]);
  const { match } = resolveShot(m, rep({ firstContact: 3, pocketed: [8], railAfterContact: true }));
  assert.equal(match.winner, 1);
  assert.equal(match.phase, 'ended');
});

test('规则：清台后合法打进黑八 → 获胜', () => {
  const m = matchWithGroups([]);
  const { match, events } = resolveShot(m, rep({ firstContact: 8, pocketed: [8], railAfterContact: true }));
  assert.equal(match.winner, 0);
  assert.ok(events.some((e) => e.type === 'gameEnd' && e.reason === 'eightWin'));
});

test('规则：清台后打进黑八同时母球落袋 → 判负', () => {
  const m = matchWithGroups([]);
  const { match } = resolveShot(m, rep({ firstContact: 8, pocketed: [8, 0], railAfterContact: true }));
  assert.equal(match.winner, 1);
});

test('规则：连击计数随连续进球递增，换人清零', () => {
  let m = matchWithGroups([1, 2, 3, 4]);
  m = resolveShot(m, rep({ firstContact: 1, pocketed: [1], railAfterContact: true })).match;
  m = resolveShot(m, rep({ firstContact: 2, pocketed: [2], railAfterContact: true })).match;
  assert.equal(m.combo, 2);
  assert.equal(m.turn, 0);
  m = resolveShot(m, rep({ firstContact: 3, railAfterContact: true })).match;
  assert.equal(m.combo, 0);
  assert.equal(m.turn, 1);
});

test('练习模式：只记进球与连击，不换人不判规', () => {
  let m = newMatch(); m.mode = 'practice';
  m = resolvePractice(m, rep({ firstContact: 5, pocketed: [5] })).match;
  m = resolvePractice(m, rep({ firstContact: 6, pocketed: [6] })).match;
  assert.equal(m.scores[0], 2);
  assert.equal(m.combo, 2);
  assert.equal(m.turn, 0);
});

// ---------- 物理（需要 Rapier） ----------

test('物理：开球后全部球静止，且没有球穿出台面', needRapier, () => {
  const sim = new Sim(RAPIER, { seed: 9 });
  assert.ok(sim.strike({ angle: 0, power: 1 }));
  sim.runUntilStill(60);
  assert.equal(sim.phase, 'idle');
  for (let n = 0; n < 16; n++) {
    const p = sim.ballPos(n);
    if (!p) continue;
    assert.ok(Math.abs(p.x) <= HALF_L + 0.01 && Math.abs(p.z) <= HALF_W + 0.01, `球 ${n} 出界 ${JSON.stringify(p)}`);
    assert.ok(Math.abs(p.y - BALL_R) < 0.003, `球 ${n} 高度异常 ${p.y}`);
  }
  sim.dispose();
});

test('物理：开球有首次接触与库边事件', needRapier, () => {
  const sim = new Sim(RAPIER, { seed: 9 });
  sim.strike({ angle: 0, power: 1 });
  sim.runUntilStill(60);
  const ev = sim.drainEvents();
  const end = ev.find((e) => e.type === 'shotEnd');
  assert.ok(end, '应有 shotEnd 事件');
  assert.ok(end.report.firstContact != null);
  assert.ok(ev.some((e) => e.type === 'strike' && e.isBreak));
  sim.dispose();
});

test('物理：直线正碰，目标球获得大部分动量，母球近乎停住（定杆）', needRapier, () => {
  const sim = new Sim(RAPIER, { seed: 1 });
  // 清空，只留母球与 1 号球
  for (let n = 1; n < 16; n++) sim._remove(n);
  sim._spawn(0, -0.5, 0);
  sim._spawn(1, 0.3, 0);
  sim.strike({ angle: 0, power: 0.5, spinY: 0 });
  // 在“首次碰球后 0.1 s”量速度：目标球随后会撞库回弹（真实物理），不能等全停再按位置断言
  let hit = false, vCue = -1, vObj = -1, maxObjX = 0.3;
  for (let i = 0; i < 240 * 8; i++) {
    sim._step();
    const o = sim.ballPos(1);
    if (o) maxObjX = Math.max(maxObjX, o.x);
    if (!hit && sim.balls[1]) {
      const vo = sim.balls[1].linvel();
      if (Math.hypot(vo.x, vo.z) > 0.2) {
        hit = true;
        for (let k = 0; k < 24; k++) sim._step();   // 让碰撞完成分离
        const vc = sim.balls[0] ? sim.balls[0].linvel() : { x: 0, z: 0 };
        const vo2 = sim.balls[1].linvel();
        vCue = Math.hypot(vc.x, vc.z); vObj = Math.hypot(vo2.x, vo2.z);
      }
    } else if (hit && sim.phase === 'idle') break;
  }
  assert.ok(hit, '应发生碰撞');
  assert.ok(vObj > 1.5, `目标球碰后应获得大部分动量：${vObj.toFixed(3)} m/s`);
  assert.ok(vCue < 0.5, `母球应近乎停住：${vCue.toFixed(3)} m/s`);
  assert.ok(vObj > vCue * 3, '目标球速度应显著大于母球');
  assert.ok(maxObjX > 1.0, `1 号球应滚过大部分台面：最远 x=${maxObjX.toFixed(3)}`);
  sim.dispose();
});

test('物理：力度→杆速为二次映射（半力≈中等杆速，满力=开球速度）', needRapier, () => {
  const speedAt = (power) => {
    const sim = new Sim(RAPIER, { seed: 2 });
    for (let n = 1; n < 16; n++) sim._remove(n);
    sim._spawn(0, -0.5, 0);
    assert.ok(sim.strike({ angle: 0, power }));
    const v = sim.balls[0].linvel();
    sim.dispose();
    return Math.hypot(v.x, v.z);
  };
  const vHalf = speedAt(0.5), vFull = speedAt(1);
  assert.ok(vHalf > 2.4 && vHalf < 3.1, `半力杆速应在中等区间：${vHalf.toFixed(3)} m/s`);
  assert.ok(vFull > 9.5 && vFull < 10.5, `满力应到开球杆速：${vFull.toFixed(3)} m/s`);
});

test('物理：低杆（拉杆）让母球碰后回退，高杆（推杆）让母球前进', needRapier, () => {
  const run = (spinY) => {
    const sim = new Sim(RAPIER, { seed: 1 });
    for (let n = 1; n < 16; n++) sim._remove(n);
    sim._spawn(0, -0.5, 0);
    sim._spawn(1, 0.0, 0);
    sim.strike({ angle: 0, power: 0.6, spinY });
    sim.runUntilStill(30);
    const c = sim.ballPos(0);
    sim.dispose();
    return c ? c.x : -999;
  };
  const draw = run(-1), follow = run(+1);
  assert.ok(draw < follow, `拉杆(${draw.toFixed(3)}) 应落在推杆(${follow.toFixed(3)}) 之后`);
});

test('物理：打进球后该球离开台面并记入 pocketed', needRapier, () => {
  const sim = new Sim(RAPIER, { seed: 1 });
  for (let n = 1; n < 16; n++) sim._remove(n);
  sim._spawn(0, 1.0, -0.4);
  sim._spawn(5, 1.2, 0.0);
  // 5 号球正对右下角袋方向（x=HALF_L, z=HALF_W）：沿 5 号球→角袋方向推母球使其带动
  const target = { x: HALF_L, z: HALF_W };
  const b = sim.ballPos(5);
  const ang = Math.atan2(target.z - b.z, target.x - b.x);
  // 母球放到 5 号球背后，沿袋口方向直击
  const gx = b.x - Math.cos(ang) * 0.3, gz = b.z - Math.sin(ang) * 0.3;
  sim._spawn(0, gx, gz);
  sim.strike({ angle: ang, power: 0.45 });
  sim.runUntilStill(30);
  const end = sim.drainEvents().find((e) => e.type === 'shotEnd');
  assert.ok(end.report.pocketed.includes(5), `5 号球应落袋：${JSON.stringify(end.report)}`);
  assert.equal(sim.ballPos(5), null);
  sim.dispose();
});

test('物理：快照格式与落袋球标记', needRapier, () => {
  const sim = new Sim(RAPIER, { seed: 1 });
  const s = sim.snapshot();
  assert.equal(s.length, 16 * SNAP_STRIDE);
  assert.equal(s[0], 0);
  assert.ok(Math.abs(s[1] - HEAD_SPOT.x) < 1e-6);
  sim.dispose();
});

test('物理：同样输入 → 同样结果（确定性）', needRapier, () => {
  const run = () => {
    const sim = new Sim(RAPIER, { seed: 9 });
    sim.strike({ angle: 0.02, power: 0.9, spinX: 0.3, spinY: -0.2 });
    sim.runUntilStill(60);
    const s = Array.from(sim.snapshot());
    sim.dispose();
    return s;
  };
  const a = run(), b = run();
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-5, `索引 ${i} 不一致`);
});

test('物理：自由球不能与其他球重叠或放进袋口', needRapier, () => {
  const sim = new Sim(RAPIER, { seed: 1 });
  const o = sim.ballPos(1);
  assert.equal(sim.placeCue(o.x, o.z), false);
  assert.equal(sim.placeCue(-HALF_L, -HALF_W), false);
  assert.equal(sim.placeCue(-0.5, 0.2), true);
  sim.dispose();
});
