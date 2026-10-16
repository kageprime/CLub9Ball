// avatarAnims.js 程序化骨骼动画库单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as anims from '../src/avatarAnims.js';

// 标准人体骨骼白名单
const ALLOWED_BONES = new Set([
  'Root', 'Spine', 'Chest', 'Neck', 'Head',
  'L_Shoulder', 'L_UpperArm', 'L_ForeArm', 'L_Hand',
  'R_Shoulder', 'R_UpperArm', 'R_ForeArm', 'R_Hand',
  'L_UpperLeg', 'L_LowerLeg', 'L_Foot',
  'R_UpperLeg', 'R_LowerLeg', 'R_Foot'
]);

test('quat & lerpQuats：四元数计算与插值工具', () => {
  // 1. 三参数构造
  const q1 = anims.quat(Math.PI / 2, 0, 0);
  assert.equal(q1.length, 4);
  const qObj1 = new THREE.Quaternion(...q1);
  assert.ok(Math.abs(qObj1.length() - 1.0) < 1e-5, '四元数应为单位四元数');

  // 2. 数组输入
  const q2 = anims.quat([0, Math.PI / 2, 0]);
  assert.equal(q2.length, 4);

  // 3. THREE.Euler 输入
  const euler = new THREE.Euler(0, 0, Math.PI / 4);
  const q3 = anims.quat(euler);
  assert.equal(q3.length, 4);

  // 4. 空参数单位元
  const qZero = anims.quat();
  assert.deepEqual(qZero, [0, 0, 0, 1]);

  // 5. lerpQuats 球面线性插值
  const mid = anims.lerpQuats([0, 0, 0, 1], q1, 0.5);
  assert.equal(mid.length, 4);
  const midLen = Math.hypot(...mid);
  assert.ok(Math.abs(midLen - 1.0) < 1e-4, '插值结果四元数应保持单位模长');
});

test('23 个核心动画片段规格与骨骼合法性', () => {
  const expectedClips = [
    { fn: anims.makeIdle, name: 'idle', duration: 2.0 },
    { fn: anims.makeWalk, name: 'walk', duration: 0.8 },
    { fn: anims.makeIdleLean, name: 'idleLean', duration: 3.0 },
    { fn: anims.makeSitIdle, name: 'sitIdle', duration: 2.5 },
    { fn: anims.makePoolStance, name: 'poolStance', duration: 0.3 },
    { fn: anims.makePoolStroke, name: 'poolStroke', duration: 0.4 },
    { fn: anims.makePoolWatch, name: 'poolWatch', duration: 3.0 },
    { fn: anims.makeDartStance, name: 'dartStance', duration: 0.3 },
    { fn: anims.makeDartThrow, name: 'dartThrow', duration: 0.35 },
    { fn: anims.makeDartCelebrate, name: 'dartCelebrate', duration: 1.0 },
    { fn: anims.makeGunPickup, name: 'gunPickup', duration: 0.6 },
    { fn: anims.makeGunAimTemple, name: 'gunAimTemple', duration: 0.8 },
    { fn: anims.makeGunTrigger, name: 'gunTrigger', duration: 0.15 },
    { fn: anims.makeGunClickRelief, name: 'gunClickRelief', duration: 1.2 },
    { fn: anims.makeGunBangRecoil, name: 'gunBangRecoil', duration: 0.8 },
    { fn: anims.makeGunPutdown, name: 'gunPutdown', duration: 0.5 },
    { fn: anims.makeGunSpinCylinder, name: 'gunSpinCylinder', duration: 0.7 },
    { fn: anims.makeDiceRoll, name: 'diceRoll', duration: 0.5 },
    { fn: anims.makeDiceCupsShake, name: 'diceCupsShake', duration: 1.6 },
    { fn: anims.makeDiceCupsLift, name: 'diceCupsLift', duration: 0.8 },
    { fn: anims.makeReactWin, name: 'reactWin', duration: 1.0 },
    { fn: anims.makeReactLose, name: 'reactLose', duration: 1.0 },
    { fn: anims.makeBartenderWipe, name: 'bartenderWipe', duration: 3.0 }
  ];

  assert.equal(expectedClips.length, 23, '必须恰好导出 23 个专用动画生成器');

  for (const { fn, name, duration } of expectedClips) {
    assert.equal(typeof fn, 'function', `${name} 生成函数应存在`);
    const clip = fn();
    assert.ok(clip instanceof THREE.AnimationClip, `${name} 应为 THREE.AnimationClip 实例`);
    assert.equal(clip.name, name, `${name} clip.name 应匹配`);
    assert.ok(Math.abs(clip.duration - duration) < 1e-4, `${name} 时长应为 ${duration}s, 实际为 ${clip.duration}s`);
    assert.ok(clip.tracks.length > 0, `${name} 应包含关键帧轨道`);

    // 检查所有轨道与骨骼名称
    for (const track of clip.tracks) {
      const [boneName, property] = track.name.split('.');
      assert.ok(ALLOWED_BONES.has(boneName), `轨道骨骼名 ${boneName} 应在标准人形骨骼白名单内 (clip: ${name})`);
      assert.ok(property === 'quaternion' || property === 'position', `属性仅支持 quaternion 或 position`);

      // 验证关键帧数值无 NaN
      for (const t of track.times) {
        assert.ok(!Number.isNaN(t) && Number.isFinite(t), `时间点不合法: ${t}`);
      }
      for (const v of track.values) {
        assert.ok(!Number.isNaN(v) && Number.isFinite(v), `数值不合法: ${v}`);
      }
    }
  }
});

test('getClip：支持别名获取与实例缓存', () => {
  // 1. 简短名与 make* 名称获取同一缓存对象
  const clip1 = anims.getClip('idle');
  const clip2 = anims.getClip('makeIdle');
  const clip3 = anims.getClip('Idle');
  assert.ok(clip1 instanceof THREE.AnimationClip);
  assert.equal(clip1, clip2, 'idle 与 makeIdle 应返回同一缓存对象');
  assert.equal(clip1, clip3, '大小写变体应统一命中缓存');

  // 2. 验证动作名
  const diceShake = anims.getClip('diceCupsShake');
  assert.equal(diceShake.name, 'diceCupsShake');
  assert.equal(diceShake.duration, 1.6);

  // 3. 不存在时返回 null
  assert.equal(anims.getClip('nonExistentAnimation'), null);
});
