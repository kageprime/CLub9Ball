// 双骨骼分析解 IK 求解器：用于角色手臂动态指向目标（母球、飞镖、左轮、骰子等）
// 基于余弦定理的解析求解，纯世界坐标计算后映射回骨骼局部旋转，无每帧内存分配。

import * as THREE from 'three';

// ---------------------------------------------------------------- 模块级复用临时变量（避免每帧 GC）
const _m1 = new THREE.Matrix4();
const _vZero = new THREE.Vector3(0, 0, 0), _vDefaultUp = new THREE.Vector3(0, 1, 0), _zAxis = new THREE.Vector3(0, 0, 1);
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _toTarget = new THREE.Vector3(), _targetDir = new THREE.Vector3();
const _clampedTarget = new THREE.Vector3(), _toPole = new THREE.Vector3(), _planeNormal = new THREE.Vector3(), _bendDir = new THREE.Vector3();
const _upperDir = new THREE.Vector3(), _upperUp = new THREE.Vector3(), _upperRestDir = new THREE.Vector3();
const _lowerDir = new THREE.Vector3(), _lowerUp = new THREE.Vector3(), _lowerRestDir = new THREE.Vector3();

const _qUpperTargetWorld = new THREE.Quaternion(), _qUpperBoneOffset = new THREE.Quaternion();
const _qUpperWorld = new THREE.Quaternion(), _qParentWorld = new THREE.Quaternion();
const _qLowerTargetWorld = new THREE.Quaternion(), _qLowerBoneOffset = new THREE.Quaternion();
const _qLowerWorld = new THREE.Quaternion(), _qUpperWorldNow = new THREE.Quaternion();

/**
 * 计算朝向四元数（以 forward 为前向 +Z，up 为参考上方 +Y）
 * @param {THREE.Vector3} forward - 前向向量
 * @param {THREE.Vector3} [up] - 参考上方向量
 * @param {THREE.Quaternion} [out] - 可选的输出四元数
 * @returns {THREE.Quaternion}
 */
export function lookRotation(forward, up = _vDefaultUp, out = new THREE.Quaternion()) {
  _m1.lookAt(forward, _vZero, up);
  return out.setFromRotationMatrix(_m1);
}

/**
 * 双骨骼两段式 IK 分析解算器
 * @param {THREE.Bone} upper - 上臂骨骼（上段关节）
 * @param {THREE.Bone} lower - 前臂骨骼（肘关节，通常为 upper 的子节点）
 * @param {THREE.Vector3} target - 末端手部目标位置（世界坐标）
 * @param {THREE.Vector3} poleTarget - 极向参考点（世界坐标，决定手肘朝向）
 * @param {number} upperLen - 上臂长度（米）
 * @param {number} lowerLen - 前臂长度（米）
 */
export function solveTwoBoneIK(upper, lower, target, poleTarget, upperLen, lowerLen) {
  // 1. 获取肩关节世界坐标与父级世界旋转
  upper.updateWorldMatrix(true, false);
  upper.getWorldPosition(_p0);

  // 2. 目标向量与距离限幅（避免超出最远拉伸或小于最短收缩距离）
  _toTarget.subVectors(target, _p0);
  const dist = _toTarget.length();
  const maxReach = (upperLen + lowerLen) * 0.9999;
  const minReach = Math.max(Math.abs(upperLen - lowerLen) * 1.0001, 1e-4);
  const d = Math.max(minReach, Math.min(maxReach, dist));

  if (dist > 1e-6) _targetDir.copy(_toTarget).divideScalar(dist);
  else _targetDir.set(0, 0, 1);
  _clampedTarget.copy(_p0).addScaledVector(_targetDir, d);

  // 3. 余弦定理计算肩关节弯曲角（三角形三边：a=upperLen, b=lowerLen, c=d）
  const a = upperLen, b = lowerLen, c = d;
  const cosAlpha = Math.max(-1, Math.min(1, (a * a + c * c - b * b) / (2 * a * c)));
  const alpha = Math.acos(cosAlpha);

  // 4. 计算 IK 解算平面法线与极向弯曲轴（肘部弯曲方向）
  _toPole.subVectors(poleTarget, _p0);
  _planeNormal.crossVectors(_targetDir, _toPole);
  if (_planeNormal.lengthSq() < 1e-8) {
    _planeNormal.crossVectors(_targetDir, Math.abs(_targetDir.y) < 0.9 ? _vDefaultUp : _zAxis);
  }
  _planeNormal.normalize();
  _bendDir.crossVectors(_planeNormal, _targetDir).normalize();

  // 5. 计算肘关节空间世界坐标
  _p1.copy(_p0)
    .addScaledVector(_targetDir, a * Math.cos(alpha))
    .addScaledVector(_bendDir, a * Math.sin(alpha));

  // 6. 求解上臂世界旋转并转为局部四元数
  _upperDir.subVectors(_p1, _p0).normalize();
  _upperUp.crossVectors(_planeNormal, _upperDir).normalize();
  lookRotation(_upperDir, _upperUp, _qUpperTargetWorld);

  if (lower.position.lengthSq() > 1e-6) _upperRestDir.copy(lower.position).normalize();
  else _upperRestDir.set(0, -1, 0);
  _qUpperBoneOffset.setFromUnitVectors(_upperRestDir, _zAxis);
  _qUpperWorld.multiplyQuaternions(_qUpperTargetWorld, _qUpperBoneOffset);

  if (upper.parent) upper.parent.getWorldQuaternion(_qParentWorld);
  else _qParentWorld.identity();
  upper.quaternion.copy(_qParentWorld).invert().multiply(_qUpperWorld);
  upper.updateWorldMatrix(true, false);

  // 7. 求解前臂世界旋转并转为局部四元数
  _lowerDir.subVectors(_clampedTarget, _p1).normalize();
  _lowerUp.crossVectors(_planeNormal, _lowerDir).normalize();
  lookRotation(_lowerDir, _lowerUp, _qLowerTargetWorld);

  if (lower.children.length > 0 && lower.children[0].position.lengthSq() > 1e-6) {
    _lowerRestDir.copy(lower.children[0].position).normalize();
  } else {
    _lowerRestDir.copy(_upperRestDir);
  }
  _qLowerBoneOffset.setFromUnitVectors(_lowerRestDir, _zAxis);
  _qLowerWorld.multiplyQuaternions(_qLowerTargetWorld, _qLowerBoneOffset);

  upper.getWorldQuaternion(_qUpperWorldNow);
  lower.quaternion.copy(_qUpperWorldNow).invert().multiply(_qLowerWorld);
  lower.updateWorldMatrix(true, false);
}
