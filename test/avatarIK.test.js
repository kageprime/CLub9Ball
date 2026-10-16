// avatarIK.js 双骨骼 IK 求解器单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveTwoBoneIK, lookRotation } from '../src/avatarIK.js';

test('lookRotation：计算朝向四元数并支持复用', () => {
  const f = new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3(0, 1, 0);
  const q = lookRotation(f, u);
  const forwardOut = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  assert.ok(forwardOut.distanceTo(f) < 1e-6, '前向向量映射为 +X');

  const upOut = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  assert.ok(upOut.distanceTo(u) < 1e-6, '上方向量保持 +Y');

  // 复用 out 参数
  const reused = new THREE.Quaternion();
  const q2 = lookRotation(new THREE.Vector3(0, 0, 1), u, reused);
  assert.equal(q2, reused);
  assert.ok(Math.abs(reused.w - 1) < 1e-6);
});

test('solveTwoBoneIK：手臂在可达范围内精确触达目标（-Y 骨骼配置）', () => {
  const root = new THREE.Object3D();
  root.position.set(0.5, 1.2, -0.3);
  root.rotation.set(0.1, -0.2, 0.15);

  const upper = new THREE.Bone();
  upper.position.set(0.2, 0, 0);
  root.add(upper);

  const lower = new THREE.Bone();
  const upperLen = 0.28, lowerLen = 0.26;
  lower.position.set(0, -upperLen, 0);
  upper.add(lower);

  const hand = new THREE.Bone();
  hand.position.set(0, -lowerLen, 0);
  lower.add(hand);

  root.updateWorldMatrix(true, true);

  const target = new THREE.Vector3(0.9, 1.0, 0.1);
  const pole = new THREE.Vector3(0.7, 1.4, -0.5);

  solveTwoBoneIK(upper, lower, target, pole, upperLen, lowerLen);
  root.updateWorldMatrix(true, true);

  const handPos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  assert.ok(handPos.distanceTo(target) < 1e-5, `手部坐标应命中目标，误差=${handPos.distanceTo(target)}`);
});

test('solveTwoBoneIK：目标过远时直线拉伸限幅', () => {
  const upper = new THREE.Bone();
  upper.position.set(0, 1.5, 0);
  const lower = new THREE.Bone();
  const upperLen = 0.3, lowerLen = 0.25;
  lower.position.set(0, -upperLen, 0);
  upper.add(lower);
  const hand = new THREE.Bone();
  hand.position.set(0, -lowerLen, 0);
  lower.add(hand);

  upper.updateWorldMatrix(true, true);

  const farTarget = new THREE.Vector3(0, 1.5, 5.0); // 5米远，超出 0.55m
  const pole = new THREE.Vector3(0, 2.5, 2.5);

  solveTwoBoneIK(upper, lower, farTarget, pole, upperLen, lowerLen);
  upper.updateWorldMatrix(true, true);

  const handPos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  const reach = handPos.distanceTo(new THREE.Vector3(0, 1.5, 0));
  assert.ok(Math.abs(reach - (upperLen + lowerLen)) < 1e-3, `手臂应伸直限幅于最大长度，实测=${reach}`);
});

test('solveTwoBoneIK：目标过近时完全折叠限幅', () => {
  const upper = new THREE.Bone();
  upper.position.set(0, 1.0, 0);
  const lower = new THREE.Bone();
  const upperLen = 0.3, lowerLen = 0.25;
  lower.position.set(0, -upperLen, 0);
  upper.add(lower);
  const hand = new THREE.Bone();
  hand.position.set(0, -lowerLen, 0);
  lower.add(hand);

  upper.updateWorldMatrix(true, true);

  const closeTarget = new THREE.Vector3(0, 1.01, 0); // 距离仅 0.01m，小于 |0.3 - 0.25| = 0.05m
  const pole = new THREE.Vector3(0, 1.5, 1.0);

  solveTwoBoneIK(upper, lower, closeTarget, pole, upperLen, lowerLen);
  upper.updateWorldMatrix(true, true);

  const handPos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  const reach = handPos.distanceTo(new THREE.Vector3(0, 1.0, 0));
  assert.ok(Math.abs(reach - Math.abs(upperLen - lowerLen)) < 1e-3, `手臂应折叠限幅于最小差值，实测=${reach}`);
});

test('solveTwoBoneIK：极向目标控制肘部弯曲平面', () => {
  const upper = new THREE.Bone();
  upper.position.set(0, 1.0, 0);
  const lower = new THREE.Bone();
  const upperLen = 0.3, lowerLen = 0.3;
  lower.position.set(0, -upperLen, 0);
  upper.add(lower);
  const hand = new THREE.Bone();
  hand.position.set(0, -lowerLen, 0);
  lower.add(hand);

  upper.updateWorldMatrix(true, true);

  const target = new THREE.Vector3(0, 1.0, 0.4);
  // 极向目标在 +X 侧
  const poleX = new THREE.Vector3(1.0, 1.0, 0.2);
  solveTwoBoneIK(upper, lower, target, poleX, upperLen, lowerLen);
  upper.updateWorldMatrix(true, true);

  const elbowX = new THREE.Vector3();
  lower.getWorldPosition(elbowX);
  assert.ok(elbowX.x > 0.1, `肘关节应向 +X 偏折，实测 x=${elbowX.x}`);

  // 极向目标在 -X 侧
  const poleNegX = new THREE.Vector3(-1.0, 1.0, 0.2);
  solveTwoBoneIK(upper, lower, target, poleNegX, upperLen, lowerLen);
  upper.updateWorldMatrix(true, true);

  const elbowNegX = new THREE.Vector3();
  lower.getWorldPosition(elbowNegX);
  assert.ok(elbowNegX.x < -0.1, `肘关节应向 -X 偏折，实测 x=${elbowNegX.x}`);
});

test('solveTwoBoneIK：兼容 +Z 骨骼朝向配置', () => {
  const upper = new THREE.Bone();
  upper.position.set(0, 0, 0);
  const lower = new THREE.Bone();
  lower.position.set(0, 0, 0.3);
  upper.add(lower);
  const hand = new THREE.Bone();
  hand.position.set(0, 0, 0.25);
  lower.add(hand);

  const target = new THREE.Vector3(0.2, 0.3, 0.3);
  const pole = new THREE.Vector3(0, 1, 0);
  solveTwoBoneIK(upper, lower, target, pole, 0.3, 0.25);
  upper.updateWorldMatrix(true, true);

  const handPos = new THREE.Vector3();
  hand.getWorldPosition(handPos);
  assert.ok(handPos.distanceTo(target) < 1e-5, `+Z 骨骼应命中目标，误差=${handPos.distanceTo(target)}`);
});
