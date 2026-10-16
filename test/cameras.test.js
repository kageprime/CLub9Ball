// 镜头机位 + 电脑难度（纯逻辑）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraRig, CAMS, CAM_KEYS } from '../src/cameras.js';
import { pickShot } from '../src/ai.js';
import { newMatch } from '../src/rules.js';
import { mulberry32 } from '../src/rng.js';

const ctx = { cue: { x: -0.5, z: 0.1 }, angle: 0.3, vel: { x: 1, z: 0 }, dt: 0.016 };

test('镜头：七种机位都给出有限的位置 / 朝向 / 视角', () => {
  const rig = new CameraRig(0.8);
  for (const m of CAMS) for (const phase of ['aim', 'roll']) for (const cpu of [false, true]) {
    rig.set(m);
    const r = rig.compute(phase, cpu, ctx);
    for (const v of [r.pos.x, r.pos.y, r.pos.z, r.look.x, r.look.y, r.look.z, r.fov, r.k]) assert.ok(Number.isFinite(v), `${m}/${phase}`);
    assert.ok(r.pos.distanceTo(r.look) > 0.2, `${m} 相机与目标太近`);
    assert.ok(r.pos.y > 0.8, `${m} 相机在台面以下`);
  }
});

test('镜头：自动机位——自己瞄准用球后，电脑回合 / 球滚动用转播', () => {
  const rig = new CameraRig(0.8);
  assert.equal(rig.resolve('aim', false), 'behind');
  assert.equal(rig.resolve('aim', true), 'broadcast');
  assert.equal(rig.resolve('roll', false), 'broadcast');
  rig.set('top'); assert.equal(rig.resolve('roll', true), 'top');
});

test('镜头：循环切换、数字键映射、环绕限幅', () => {
  const rig = new CameraRig(0.8);
  assert.equal(rig.next(), 'behind'); assert.equal(rig.next(-1), 'auto'); assert.equal(rig.next(-1), CAMS[CAMS.length - 1]);
  assert.equal(Object.keys(CAM_KEYS).length, CAMS.length);
  assert.deepEqual(Object.values(CAM_KEYS), CAMS);
  rig.nudgeOrbit(0, 99, 99); assert.ok(rig.orbit.pitch <= 1.45 && rig.orbit.dist <= 3.4);
  rig.nudgeOrbit(0, -99, -99); assert.ok(rig.orbit.pitch >= 0.12 && rig.orbit.dist >= 0.9);
});

test('镜头：俯视与转播不被吊灯挡（要求隐藏吊灯），球后机位不隐藏', () => {
  const rig = new CameraRig(0.8);
  rig.set('top'); assert.equal(rig.compute('aim', false, ctx).lamps, false);
  rig.set('behind'); assert.equal(rig.compute('aim', false, ctx).lamps, true);
});

test('电脑难度：同一局面下，高手的出杆角度误差明显小于简单', () => {
  const m = newMatch();
  const cue = { x: -0.6, z: 0 }, balls = [{ n: 1, x: 0.4, z: 0.1 }];
  m.breakShot = false; m.groups = ['solid', 'stripe']; m.phase = 'play';
  const err = (skill, scale) => {
    const rng = mulberry32(5); let sum = 0; const N = 200;
    const ideal = pickShot({ cue, balls, match: m, rng: mulberry32(1), skill: 1 }).angle;
    for (let i = 0; i < N; i++) sum += Math.abs(pickShot({ cue, balls, match: m, rng, skill, noiseScale: scale }).angle - ideal);
    return sum / N;
  };
  assert.ok(err(0.35, 2.6) > err(0.94, 0.7) * 5, '简单应远不如高手准');
});

test('电脑难度：sloppy=1 时会在多条可行线里随机选', () => {
  const m = newMatch(); m.breakShot = false; m.groups = ['solid', 'stripe']; m.phase = 'play';
  const cue = { x: -0.4, z: 0 }, balls = [{ n: 1, x: 0.2, z: 0.2 }, { n: 2, x: 0.3, z: -0.3 }, { n: 3, x: 0.6, z: 0.1 }];
  const seen = new Set(); const rng = mulberry32(7);
  for (let i = 0; i < 80; i++) seen.add(pickShot({ cue, balls, match: m, rng, skill: 1, sloppy: 1 }).ball);
  assert.ok(seen.size >= 2, `只选了 ${[...seen]}`);
});
