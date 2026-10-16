// club9 人形角色程序化动画片段库
// 纯数学/关键帧驱动生成 THREE.AnimationClip，无需外部动画资产文件
// 支持标准人形骨骼层级，包含待机、行走、台球、飞镖、左轮轮盘、骰子及酒保等动作

import * as THREE from 'three';

// 模块级复用临时数学对象，避免运行时频繁 GC
const _euler = new THREE.Euler();
const _tempQuat = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/**
 * 将欧拉角转换为四元数平铺数组 [x, y, z, w]
 * 支持 THREE.Euler 实例、分量数组 [x, y, z, order?] 或独立数值参数 (x, y, z, order?)
 * @param {THREE.Euler|number[]|number} euler
 * @param {number} [y=0]
 * @param {number} [z=0]
 * @param {string} [order='XYZ']
 * @returns {number[]} 四元数分量数组 [x, y, z, w]
 */
export function quat(euler, y = 0, z = 0, order = 'XYZ') {
  if (euler instanceof THREE.Euler) {
    _tempQuat.setFromEuler(euler);
  } else if (Array.isArray(euler)) {
    _euler.set(euler[0] || 0, euler[1] || 0, euler[2] || 0, euler[3] || 'XYZ');
    _tempQuat.setFromEuler(_euler);
  } else if (typeof euler === 'number') {
    _euler.set(euler, y, z, order);
    _tempQuat.setFromEuler(_euler);
  } else {
    _tempQuat.identity();
  }
  return [_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w];
}

/**
 * 两个四元数之间的球面线性插值 (slerp)
 * @param {number[]|THREE.Quaternion} q1 - 起始四元数
 * @param {number[]|THREE.Quaternion} q2 - 目标四元数
 * @param {number} t - 插值权重 [0, 1]
 * @returns {number[]} 插值结果数组 [x, y, z, w]
 */
export function lerpQuats(q1, q2, t) {
  if (Array.isArray(q1)) _q1.fromArray(q1);
  else _q1.copy(q1);

  if (Array.isArray(q2)) _q2.fromArray(q2);
  else _q2.copy(q2);

  _q1.slerp(_q2, t);
  return [_q1.x, _q1.y, _q1.z, _q1.w];
}

// 辅助创建关键帧轨道
function qTrack(bone, times, quats) {
  const flat = quats.length === times.length * 4 ? quats : quats.flat();
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, flat);
}

function vTrack(bone, times, vectors) {
  const flat = vectors.length === times.length * 3 ? vectors : vectors.flat();
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, flat);
}

function staticQ(bone, times, q) {
  const quats = [];
  for (let i = 0; i < times.length; i++) quats.push(q);
  return qTrack(bone, times, quats);
}

// ==========================================
// 1. 基础生活动作
// ==========================================

/**
 * 1. 站立待机 (2.0s 循环)
 * 胸腔轻微呼吸起伏 (±0.004)，臀部轻微重心转移 (±0.003)，头部微弱俯仰
 */
export function makeIdle() {
  const times = [0, 0.5, 1.0, 1.5, 2.0];
  return new THREE.AnimationClip('idle', 2.0, [
    vTrack('Chest', times, [[0, 0, 0], [0, 0.004, 0], [0, 0, 0], [0, -0.004, 0], [0, 0, 0]]),
    vTrack('Root', times, [[0, 0, 0], [0.003, 0, 0], [0, 0, 0], [-0.003, 0, 0], [0, 0, 0]]),
    qTrack('Head', times, [quat(0, 0, 0), quat(0.015, 0, 0), quat(0, 0, 0), quat(-0.015, 0, 0), quat(0, 0, 0)]),
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.008, 0, 0), quat(0, 0, 0), quat(-0.008, 0, 0), quat(0, 0, 0)]),
    staticQ('L_UpperArm', times, quat(0.05, 0, 0.05)),
    staticQ('R_UpperArm', times, quat(0.05, 0, -0.05))
  ]);
}

/**
 * 2. 双足行走循环 (0.8s 循环)
 * 大腿前后摆动 (±0.4 rad，反相 180°)，小腿踢腿 (+0.1 ~ +0.7 rad 交错)，
 * 手臂与双腿反向摆动 (±0.3 rad)，髋部微幅摆动 (X ±0.02) 与脊柱微扭，头部保持平稳
 */
export function makeWalk() {
  const times = [0, 0.2, 0.4, 0.6, 0.8];
  return new THREE.AnimationClip('walk', 0.8, [
    vTrack('Root', times, [[0, 0, 0], [0.02, 0.012, 0], [0, 0, 0], [-0.02, 0.012, 0], [0, 0, 0]]),
    qTrack('Spine', times, [quat(0, -0.04, 0), quat(0, 0, 0), quat(0, 0.04, 0), quat(0, 0, 0), quat(0, -0.04, 0)]),
    qTrack('Head', times, [quat(0, 0.02, 0), quat(0, 0, 0), quat(0, -0.02, 0), quat(0, 0, 0), quat(0, 0.02, 0)]),
    qTrack('L_UpperLeg', times, [quat(0.4, 0, 0), quat(0, 0, 0), quat(-0.4, 0, 0), quat(0, 0, 0), quat(0.4, 0, 0)]),
    qTrack('R_UpperLeg', times, [quat(-0.4, 0, 0), quat(0, 0, 0), quat(0.4, 0, 0), quat(0, 0, 0), quat(-0.4, 0, 0)]),
    qTrack('L_LowerLeg', times, [quat(0.1, 0, 0), quat(0.2, 0, 0), quat(0.7, 0, 0), quat(0.4, 0, 0), quat(0.1, 0, 0)]),
    qTrack('R_LowerLeg', times, [quat(0.7, 0, 0), quat(0.4, 0, 0), quat(0.1, 0, 0), quat(0.2, 0, 0), quat(0.7, 0, 0)]),
    qTrack('L_UpperArm', times, [quat(-0.3, 0, 0.05), quat(0, 0, 0.05), quat(0.3, 0, 0.05), quat(0, 0, 0.05), quat(-0.3, 0, 0.05)]),
    qTrack('R_UpperArm', times, [quat(0.3, 0, -0.05), quat(0, 0, -0.05), quat(-0.3, 0, -0.05), quat(0, 0, -0.05), quat(0.3, 0, -0.05)]),
    staticQ('L_ForeArm', times, quat(0.2, 0, 0)),
    staticQ('R_ForeArm', times, quat(0.2, 0, 0))
  ]);
}

/**
 * 3. 倚靠待机 (3.0s 循环)
 * 重心偏向一侧腿，身体微倾，左臂搭在台面/吧台上，呼吸起伏
 */
export function makeIdleLean() {
  const times = [0, 0.75, 1.5, 2.25, 3.0];
  return new THREE.AnimationClip('idleLean', 3.0, [
    vTrack('Root', times, [[0.03, -0.01, 0], [0.033, -0.008, 0], [0.03, -0.01, 0], [0.027, -0.012, 0], [0.03, -0.01, 0]]),
    vTrack('Chest', times, [[0, 0, 0], [0, 0.003, 0], [0, 0, 0], [0, -0.003, 0], [0, 0, 0]]),
    staticQ('Root', times, quat(0, 0, 0.035)),
    staticQ('Spine', times, quat(0.02, 0, -0.035)),
    staticQ('R_UpperLeg', times, quat(-0.02, 0, -0.035)),
    staticQ('L_UpperLeg', times, quat(0.08, 0, 0.05)),
    staticQ('L_LowerLeg', times, quat(0.12, 0, 0)),
    staticQ('L_UpperArm', times, quat(0.35, 0, 0.25)),
    staticQ('L_ForeArm', times, quat(1.25, 0, 0)),
    staticQ('L_Hand', times, quat(0.15, 0, 0)),
    staticQ('R_UpperArm', times, quat(0.05, 0, -0.08)),
    staticQ('R_ForeArm', times, quat(0.2, 0, 0)),
    qTrack('Head', times, [quat(0.02, 0.05, 0), quat(0.03, 0.03, 0), quat(0.02, 0.05, 0), quat(0.01, 0.07, 0), quat(0.02, 0.05, 0)])
  ]);
}

/**
 * 4. 坐姿待机 (2.5s 循环)
 * 坐姿呼吸，双大腿前曲 ~-1.4 rad，小腿垂下 ~1.0 rad
 */
export function makeSitIdle() {
  const times = [0, 0.625, 1.25, 1.875, 2.5];
  return new THREE.AnimationClip('sitIdle', 2.5, [
    vTrack('Root', times, [[0, -0.45, 0], [0, -0.448, 0], [0, -0.45, 0], [0, -0.452, 0], [0, -0.45, 0]]),
    vTrack('Chest', times, [[0, 0, 0], [0, 0.004, 0], [0, 0, 0], [0, -0.004, 0], [0, 0, 0]]),
    staticQ('L_UpperLeg', times, quat(-1.4, 0, 0.08)),
    staticQ('R_UpperLeg', times, quat(-1.4, 0, -0.08)),
    staticQ('L_LowerLeg', times, quat(1.0, 0, 0)),
    staticQ('R_LowerLeg', times, quat(1.0, 0, 0)),
    staticQ('L_Foot', times, quat(0.4, 0, 0)),
    staticQ('R_Foot', times, quat(0.4, 0, 0)),
    staticQ('Spine', times, quat(0.05, 0, 0)),
    staticQ('L_UpperArm', times, quat(0.35, 0, 0.1)),
    staticQ('L_ForeArm', times, quat(0.85, 0, 0)),
    staticQ('R_UpperArm', times, quat(0.35, 0, -0.1)),
    staticQ('R_ForeArm', times, quat(0.85, 0, 0)),
    qTrack('Head', times, [quat(0, 0, 0), quat(0.015, 0.02, 0), quat(0, 0, 0), quat(-0.015, -0.02, 0), quat(0, 0, 0)])
  ]);
}

// ==========================================
// 2. 台球动作
// ==========================================

/**
 * 5. 台球俯身瞄准姿态 (0.3s 单次)
 * 躯干俯身 (Spine X ~0.25 rad)，右手持杆后拉准备击球，左手伸出架桥
 */
export function makePoolStance() {
  const times = [0, 0.15, 0.3];
  return new THREE.AnimationClip('poolStance', 0.3, [
    vTrack('Root', times, [[0, 0, 0], [0, -0.03, 0], [0, -0.06, 0]]),
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.12, 0, 0), quat(0.25, 0, 0)]),
    qTrack('Chest', times, [quat(0, 0, 0), quat(0.08, 0, 0), quat(0.15, 0, 0)]),
    qTrack('Head', times, [quat(0, 0, 0), quat(-0.15, 0, 0), quat(-0.3, 0, 0)]),
    qTrack('L_UpperArm', times, [quat(0.1, 0, 0.1), quat(0.45, 0, 0.15), quat(0.75, 0, 0.2)]),
    qTrack('L_ForeArm', times, [quat(0.2, 0, 0), quat(0.35, 0, 0), quat(0.5, 0, 0)]),
    qTrack('L_Hand', times, [quat(0, 0, 0), quat(0.1, 0, 0), quat(0.2, 0, 0.05)]),
    qTrack('R_UpperArm', times, [quat(0.1, 0, -0.1), quat(0.35, -0.05, -0.1), quat(0.55, -0.1, -0.1)]),
    qTrack('R_ForeArm', times, [quat(0.2, 0, 0), quat(0.8, 0, 0), quat(1.4, 0, 0)]),
    qTrack('R_Hand', times, [quat(0, 0, 0), quat(0.1, 0, 0), quat(0.15, 0, 0)]),
    qTrack('L_UpperLeg', times, [quat(0, 0, 0), quat(0.15, 0, 0.05), quat(0.3, 0, 0.05)]),
    qTrack('R_UpperLeg', times, [quat(0, 0, 0), quat(-0.15, 0, -0.05), quat(-0.3, 0, -0.05)])
  ]);
}

/**
 * 6. 台球运杆/击球抽杆 (0.4s 单次)
 * 右臂拉杆后迅速向前抽击击球
 */
export function makePoolStroke() {
  const times = [0, 0.16, 0.28, 0.4];
  return new THREE.AnimationClip('poolStroke', 0.4, [
    staticQ('Spine', times, quat(0.25, 0, 0)),
    qTrack('Chest', times, [quat(0.15, 0, 0), quat(0.15, 0, 0), quat(0.18, 0, 0), quat(0.16, 0, 0)]),
    staticQ('Head', times, quat(-0.3, 0, 0)),
    staticQ('L_UpperArm', times, quat(0.75, 0, 0.2)),
    staticQ('L_ForeArm', times, quat(0.5, 0, 0)),
    staticQ('L_Hand', times, quat(0.2, 0, 0.05)),
    qTrack('R_UpperArm', times, [quat(0.55, -0.1, -0.1), quat(0.58, -0.1, -0.1), quat(0.52, -0.1, -0.1), quat(0.55, -0.1, -0.1)]),
    qTrack('R_ForeArm', times, [quat(1.4, 0, 0), quat(1.8, 0, 0), quat(0.95, 0, 0), quat(1.15, 0, 0)]),
    qTrack('R_Hand', times, [quat(0.15, 0, 0), quat(0.25, 0, 0), quat(-0.15, 0, 0), quat(0.05, 0, 0)])
  ]);
}

/**
 * 7. 观球待机 (3.0s 循环)
 * 站立放松，手持竖立球杆，头部转动注视桌面
 */
export function makePoolWatch() {
  const times = [0, 0.75, 1.5, 2.25, 3.0];
  return new THREE.AnimationClip('poolWatch', 3.0, [
    vTrack('Root', times, [[0, 0, 0], [0.005, 0, 0], [0, 0, 0], [-0.005, 0, 0], [0, 0, 0]]),
    vTrack('Chest', times, [[0, 0, 0], [0, 0.003, 0], [0, 0, 0], [-0.003, 0, 0], [0, 0, 0]]),
    staticQ('R_UpperArm', times, quat(0.25, 0, -0.08)),
    staticQ('R_ForeArm', times, quat(1.25, 0, 0)),
    staticQ('R_Hand', times, quat(0.15, 0, 0)),
    staticQ('L_UpperArm', times, quat(0.08, 0, 0.12)),
    staticQ('L_ForeArm', times, quat(0.35, 0, 0)),
    qTrack('Head', times, [quat(0.1, 0, 0), quat(0.1, 0.1, 0), quat(0.1, 0, 0), quat(0.1, -0.08, 0), quat(0.1, 0, 0)])
  ]);
}

// ==========================================
// 3. 飞镖动作
// ==========================================

/**
 * 8. 飞镖瞄准姿态 (0.3s 单次)
 * 侧身站立，右臂抬至眼部高度，手肘弯曲备投
 */
export function makeDartStance() {
  const times = [0, 0.15, 0.3];
  return new THREE.AnimationClip('dartStance', 0.3, [
    qTrack('Root', times, [quat(0, 0, 0), quat(0, -0.18, 0), quat(0, -0.35, 0)]),
    qTrack('Spine', times, [quat(0, 0, 0), quat(0, -0.08, 0), quat(0, -0.15, 0)]),
    qTrack('Head', times, [quat(0, 0, 0), quat(0, 0.25, 0), quat(0, 0.45, 0)]),
    qTrack('R_UpperArm', times, [quat(0.1, 0, -0.1), quat(0.75, -0.1, -0.1), quat(1.35, -0.2, -0.1)]),
    qTrack('R_ForeArm', times, [quat(0.2, 0, 0), quat(0.95, 0, 0), quat(1.75, 0, 0)]),
    qTrack('R_Hand', times, [quat(0, 0, 0), quat(0.1, 0, 0), quat(0.2, 0, 0)]),
    staticQ('L_UpperArm', times, quat(0.15, 0, 0.15)),
    staticQ('L_ForeArm', times, quat(0.4, 0, 0))
  ]);
}

/**
 * 9. 投掷飞镖 (0.35s 单次)
 * 右臂快速向前伸展出手，手腕下甩脱手跟随
 */
export function makeDartThrow() {
  const times = [0, 0.1, 0.18, 0.26, 0.35];
  return new THREE.AnimationClip('dartThrow', 0.35, [
    staticQ('Root', times, quat(0, -0.35, 0)),
    staticQ('Head', times, quat(0, 0.45, 0)),
    qTrack('Spine', times, [quat(0, -0.15, 0), quat(0.04, -0.15, 0), quat(0.08, -0.12, 0), quat(0.06, -0.12, 0), quat(0.03, -0.12, 0)]),
    qTrack('R_UpperArm', times, [quat(1.35, -0.2, -0.1), quat(1.4, -0.15, -0.1), quat(1.42, -0.1, -0.1), quat(1.35, -0.1, -0.1), quat(1.25, -0.1, -0.1)]),
    qTrack('R_ForeArm', times, [quat(1.75, 0, 0), quat(1.1, 0, 0), quat(0.35, 0, 0), quat(0.1, 0, 0), quat(0.25, 0, 0)]),
    qTrack('R_Hand', times, [quat(0.2, 0, 0), quat(0.25, 0, 0), quat(-0.4, 0, 0), quat(-0.2, 0, 0), quat(0, 0, 0)])
  ]);
}

/**
 * 10. 飞镖得分庆祝 (1.0s 单次)
 * 振臂挥拳，身体小跳起伏，双臂高举欢呼
 */
export function makeDartCelebrate() {
  const times = [0, 0.15, 0.3, 0.5, 0.75, 1.0];
  return new THREE.AnimationClip('dartCelebrate', 1.0, [
    vTrack('Root', times, [[0, 0, 0], [0, -0.02, 0], [0, 0.08, 0], [0, -0.01, 0], [0, 0, 0], [0, 0, 0]]),
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.05, 0, 0), quat(-0.15, 0, 0), quat(-0.1, 0, 0), quat(-0.05, 0, 0), quat(0, 0, 0)]),
    qTrack('Head', times, [quat(0, 0, 0), quat(0, 0, 0), quat(-0.25, 0, 0), quat(-0.2, 0, 0), quat(-0.1, 0, 0), quat(0, 0, 0)]),
    qTrack('R_UpperArm', times, [quat(0.2, 0, -0.1), quat(0.8, 0, -0.2), quat(1.7, 0, -0.4), quat(0.9, 0, -0.3), quat(1.5, 0, -0.35), quat(0.4, 0, -0.1)]),
    qTrack('R_ForeArm', times, [quat(0.3, 0, 0), quat(0.8, 0, 0), quat(1.2, 0, 0), quat(1.5, 0, 0), quat(1.1, 0, 0), quat(0.5, 0, 0)]),
    qTrack('L_UpperArm', times, [quat(0.1, 0, 0.1), quat(0.4, 0, 0.5), quat(0.6, 0, 0.9), quat(0.5, 0, 0.7), quat(0.3, 0, 0.5), quat(0.1, 0, 0.1)]),
    qTrack('L_ForeArm', times, [quat(0.2, 0, 0), quat(0.6, 0, 0), quat(1.0, 0, 0), quat(0.8, 0, 0), quat(0.4, 0, 0), quat(0.2, 0, 0)])
  ]);
}

// ==========================================
// 4. 左轮轮盘动作
// ==========================================

/**
 * 11. 从桌面拿起左轮枪 (0.6s 单次)
 * 右臂向前下方伸出到桌面高度拿枪，随后抬起至胸前
 */
export function makeGunPickup() {
  const times = [0, 0.25, 0.38, 0.6];
  return new THREE.AnimationClip('gunPickup', 0.6, [
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.18, 0, 0), quat(0.1, 0, 0), quat(0, 0, 0)]),
    qTrack('Head', times, [quat(0, 0, 0), quat(0.2, 0, 0), quat(0.15, 0, 0), quat(0.05, 0, 0)]),
    qTrack('R_UpperArm', times, [quat(0.1, 0, -0.1), quat(0.75, -0.1, -0.1), quat(0.6, -0.05, -0.1), quat(0.35, 0, -0.1)]),
    qTrack('R_ForeArm', times, [quat(0.2, 0, 0), quat(0.45, 0, 0), quat(0.8, 0, 0), quat(1.25, 0, 0)]),
    qTrack('R_Hand', times, [quat(0, 0, 0), quat(0.1, 0, 0), quat(0.2, 0, 0), quat(0.15, 0, 0)])
  ]);
}

/**
 * 12. 举枪对准右侧太阳穴 (0.8s 单次)
 * 慢动作戏剧性举枪，手肘外展，枪口抵在右太阳穴
 */
export function makeGunAimTemple() {
  const times = [0, 0.25, 0.55, 0.8];
  return new THREE.AnimationClip('gunAimTemple', 0.8, [
    qTrack('Spine', times, [quat(0, 0, 0), quat(-0.02, 0, 0), quat(-0.05, 0, 0), quat(-0.06, 0, 0)]),
    qTrack('Head', times, [quat(0, 0, 0), quat(0.02, 0, 0.03), quat(0.04, 0, 0.08), quat(0.05, 0, 0.1)]),
    qTrack('R_UpperArm', times, [quat(0.35, 0, -0.1), quat(0.3, -0.2, -0.6), quat(0.22, -0.4, -1.1), quat(0.2, -0.5, -1.35)]),
    qTrack('R_ForeArm', times, [quat(1.25, 0, 0), quat(1.6, 0, 0), quat(2.0, 0, 0), quat(2.25, 0, 0)]),
    qTrack('R_Hand', times, [quat(0.15, 0, 0), quat(0.12, 0, 0.1), quat(0.1, 0, 0.2), quat(0.1, 0, 0.3)])
  ]);
}

/**
 * 13. 扣动扳机 (0.15s 单次)
 * 手指微弱扣紧动作 (右手四元数 Z 轴细微位移)
 */
export function makeGunTrigger() {
  const times = [0, 0.06, 0.11, 0.15];
  return new THREE.AnimationClip('gunTrigger', 0.15, [
    staticQ('R_UpperArm', times, quat(0.2, -0.5, -1.35)),
    staticQ('R_ForeArm', times, quat(2.25, 0, 0)),
    qTrack('R_Hand', times, [quat(0.1, 0, 0.3), quat(0.14, 0, 0.36), quat(0.18, 0, 0.44), quat(0.15, 0, 0.38)]),
    qTrack('Head', times, [quat(0.05, 0, 0.1), quat(0.06, 0, 0.12), quat(0.07, 0, 0.13), quat(0.05, 0, 0.1)])
  ]);
}

/**
 * 14. 空枪劫后余生/释怀 (1.2s 单次)
 * 大口呼气 (胸口下沉)，枪稍放下，持枪手颤抖 (高频四元数抖动)，头向后仰
 */
export function makeGunClickRelief() {
  const times = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.05, 1.2];
  return new THREE.AnimationClip('gunClickRelief', 1.2, [
    vTrack('Chest', times, [
      [0, 0, 0], [0, -0.003, 0], [0, -0.008, 0], [0, -0.012, 0], [0, -0.015, 0], [0, -0.014, 0],
      [0, -0.012, 0], [0, -0.010, 0], [0, -0.008, 0], [0, -0.006, 0], [0, -0.003, 0], [0, 0, 0]
    ]),
    qTrack('Head', times, [
      quat(0.05, 0, 0.1), quat(0, 0, 0.08), quat(-0.1, 0, 0.05), quat(-0.2, 0, 0), quat(-0.28, 0, 0), quat(-0.27, 0, 0),
      quat(-0.25, 0, 0), quat(-0.20, 0, 0), quat(-0.15, 0, 0), quat(-0.10, 0, 0), quat(-0.06, 0, 0), quat(0, 0, 0)
    ]),
    qTrack('R_UpperArm', times, [
      quat(0.2, -0.5, -1.35), quat(0.2, -0.45, -1.3), quat(0.22, -0.4, -1.2), quat(0.25, -0.3, -1.05), quat(0.28, -0.2, -0.9), quat(0.3, -0.15, -0.8),
      quat(0.3, -0.15, -0.8), quat(0.3, -0.15, -0.8), quat(0.3, -0.15, -0.8), quat(0.3, -0.15, -0.8), quat(0.3, -0.15, -0.8), quat(0.3, -0.15, -0.8)
    ]),
    qTrack('R_ForeArm', times, [
      quat(2.25, 0, 0), quat(2.2, 0, 0), quat(2.1, 0, 0), quat(1.95, 0, 0), quat(1.8, 0, 0), quat(1.7, 0, 0),
      quat(1.7, 0, 0), quat(1.7, 0, 0), quat(1.7, 0, 0), quat(1.7, 0, 0), quat(1.7, 0, 0), quat(1.7, 0, 0)
    ]),
    qTrack('R_Hand', times, [
      quat(0.1, 0, 0.3), quat(0.12, 0, 0.36), quat(0.08, 0, 0.24), quat(0.14, 0, 0.35), quat(0.07, 0, 0.23), quat(0.13, 0, 0.33),
      quat(0.08, 0, 0.25), quat(0.12, 0, 0.31), quat(0.09, 0, 0.26), quat(0.11, 0, 0.29), quat(0.1, 0, 0.28), quat(0.1, 0, 0.25)
    ])
  ]);
}

/**
 * 15. 枪响中弹后坐力瘫倒 (0.8s 单次)
 * 头部向右后剧烈甩动，躯干向后骤退，持枪手臂被震飞，身体瘫倒下坠
 */
export function makeGunBangRecoil() {
  const times = [0, 0.06, 0.15, 0.35, 0.55, 0.8];
  return new THREE.AnimationClip('gunBangRecoil', 0.8, [
    vTrack('Root', times, [[0, 0, 0], [0, 0.02, -0.02], [0, -0.06, -0.01], [0, -0.16, 0.02], [0, -0.23, 0.04], [0, -0.28, 0.05]]),
    qTrack('Head', times, [
      quat(0.05, 0, 0.1), quat(-0.35, -0.65, -0.45), quat(-0.4, -0.7, -0.5), quat(0.2, -0.4, -0.3), quat(0.4, -0.3, -0.25), quat(0.5, -0.25, -0.2)
    ]),
    qTrack('Spine', times, [
      quat(0, 0, 0), quat(-0.35, 0, -0.1), quat(-0.3, 0, -0.08), quat(0.12, 0, 0.05), quat(0.22, 0, 0.08), quat(0.28, 0, 0.1)
    ]),
    qTrack('Chest', times, [
      quat(0, 0, 0), quat(-0.25, 0, -0.08), quat(-0.2, 0, -0.06), quat(0.1, 0, 0.04), quat(0.18, 0, 0.06), quat(0.22, 0, 0.08)
    ]),
    qTrack('R_UpperArm', times, [
      quat(0.2, -0.5, -1.35), quat(0.7, 0, -1.6), quat(0.6, 0.1, -1.4), quat(0.25, 0, -0.5), quat(0.12, 0, -0.2), quat(0.05, 0, -0.1)
    ]),
    qTrack('R_ForeArm', times, [quat(2.25, 0, 0), quat(0.4, 0, 0), quat(0.3, 0, 0), quat(0.2, 0, 0), quat(0.1, 0, 0), quat(0.05, 0, 0)]),
    qTrack('L_UpperArm', times, [quat(0.1, 0, 0.1), quat(0.4, 0, 0.6), quat(0.3, 0, 0.4), quat(0.15, 0, 0.2), quat(0.08, 0, 0.1), quat(0.05, 0, 0.05)])
  ]);
}

/**
 * 16. 将左轮枪放回桌面 (0.5s 单次)
 * 手臂前移向下将枪放回桌面，随后自然收手
 */
export function makeGunPutdown() {
  const times = [0, 0.2, 0.35, 0.5];
  return new THREE.AnimationClip('gunPutdown', 0.5, [
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.12, 0, 0), quat(0.08, 0, 0), quat(0, 0, 0)]),
    qTrack('R_UpperArm', times, [quat(0.35, 0, -0.1), quat(0.65, -0.05, -0.1), quat(0.45, 0, -0.1), quat(0.1, 0, -0.1)]),
    qTrack('R_ForeArm', times, [quat(1.25, 0, 0), quat(0.5, 0, 0), quat(0.35, 0, 0), quat(0.2, 0, 0)]),
    qTrack('R_Hand', times, [quat(0.15, 0, 0), quat(0.2, 0, 0), quat(0.05, 0, 0), quat(0, 0, 0)])
  ]);
}

/**
 * 17. 旋转弹巢 (0.7s 单次)
 * 左手横跨胸前拨动转轮弹巢 (L_ForeArm 快速旋转扭动)，掌心轻拂抽离
 */
export function makeGunSpinCylinder() {
  const times = [0, 0.2, 0.35, 0.48, 0.7];
  return new THREE.AnimationClip('gunSpinCylinder', 0.7, [
    staticQ('R_UpperArm', times, quat(0.3, 0, -0.1)),
    staticQ('R_ForeArm', times, quat(1.3, 0, 0)),
    staticQ('R_Hand', times, quat(0.15, 0, 0)),
    qTrack('L_UpperArm', times, [quat(0.1, 0, 0.1), quat(0.45, -0.35, 0.5), quat(0.45, -0.35, 0.5), quat(0.4, -0.25, 0.4), quat(0.1, 0, 0.1)]),
    qTrack('L_ForeArm', times, [quat(0.2, 0, 0), quat(1.45, 0.2, 0), quat(1.45, -0.8, 0.4), quat(1.4, -1.1, 0.3), quat(0.2, 0, 0)]),
    qTrack('L_Hand', times, [quat(0, 0, 0), quat(0.1, 0, 0.1), quat(-0.3, 0, 0.4), quat(-0.15, 0, 0.2), quat(0, 0, 0)])
  ]);
}

// ==========================================
// 5. 骰子动作
// ==========================================

/**
 * 18. 掷骰子 (0.5s 单次)
 * 右臂向前轻扫挥出，松手掷出骰子
 */
export function makeDiceRoll() {
  const times = [0, 0.15, 0.28, 0.4, 0.5];
  return new THREE.AnimationClip('diceRoll', 0.5, [
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.06, 0, 0), quat(0.12, 0, 0), quat(0.08, 0, 0), quat(0, 0, 0)]),
    qTrack('R_UpperArm', times, [quat(-0.25, 0, -0.1), quat(0.35, -0.05, -0.1), quat(0.65, -0.05, -0.1), quat(0.5, 0, -0.1), quat(0.25, 0, -0.1)]),
    qTrack('R_ForeArm', times, [quat(1.35, 0, 0), quat(1.0, 0, 0), quat(0.45, 0, 0), quat(0.3, 0, 0), quat(0.35, 0, 0)]),
    qTrack('R_Hand', times, [quat(0.2, 0, 0), quat(0.1, 0, 0), quat(-0.3, 0, 0), quat(-0.1, 0, 0), quat(0, 0, 0)])
  ]);
}

/**
 * 19. 剧烈摇骰盅 (1.6s 单次)
 * 双手扣紧骰盅，手臂进行 ~11Hz 的快速剧烈上下震颤
 */
export function makeDiceCupsShake() {
  const steps = 36;
  const duration = 1.6;
  const times = [];
  const rUpper = [], lUpper = [], rFore = [], lFore = [], chestPos = [], rootPos = [];

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    times.push(t);
    const env = t < 0.2 ? t / 0.2 : (t > 1.4 ? (duration - t) / 0.2 : 1.0);
    const osc = Math.sin(2 * Math.PI * 11 * t) * env;

    rUpper.push(quat(0.45 + 0.07 * osc, 0, -0.15));
    lUpper.push(quat(0.45 + 0.07 * osc, 0, 0.15));
    rFore.push(quat(1.35 + 0.10 * osc, 0, 0));
    lFore.push(quat(1.35 + 0.10 * osc, 0, 0));
    chestPos.push([0, 0.004 * osc, 0]);
    rootPos.push([0, 0.003 * osc, 0]);
  }

  return new THREE.AnimationClip('diceCupsShake', duration, [
    qTrack('R_UpperArm', times, rUpper),
    qTrack('L_UpperArm', times, lUpper),
    qTrack('R_ForeArm', times, rFore),
    qTrack('L_ForeArm', times, lFore),
    vTrack('Chest', times, chestPos),
    vTrack('Root', times, rootPos),
    staticQ('Spine', times, quat(0.08, 0, 0)),
    staticQ('Head', times, quat(0.15, 0, 0))
  ]);
}

/**
 * 20. 揭开骰盅 (0.8s 单次)
 * 双手抓着骰盅猛然向上掀起，戏剧性揭晓结果
 */
export function makeDiceCupsLift() {
  const times = [0, 0.15, 0.45, 0.65, 0.8];
  return new THREE.AnimationClip('diceCupsLift', 0.8, [
    vTrack('Chest', times, [[0, 0, 0], [0, -0.005, 0], [0, 0.015, 0], [0, 0.015, 0], [0, 0.012, 0]]),
    qTrack('Spine', times, [quat(0.05, 0, 0), quat(0.08, 0, 0), quat(-0.08, 0, 0), quat(-0.08, 0, 0), quat(-0.06, 0, 0)]),
    qTrack('Head', times, [quat(0.15, 0, 0), quat(0.18, 0, 0), quat(0.25, 0, 0), quat(0.25, 0, 0), quat(0.22, 0, 0)]),
    qTrack('R_UpperArm', times, [quat(0.4, 0, -0.15), quat(0.35, 0, -0.15), quat(0.85, 0, -0.25), quat(0.85, 0, -0.25), quat(0.82, 0, -0.25)]),
    qTrack('L_UpperArm', times, [quat(0.4, 0, 0.15), quat(0.35, 0, 0.15), quat(0.85, 0, 0.25), quat(0.85, 0, 0.25), quat(0.82, 0, 0.25)]),
    qTrack('R_ForeArm', times, [quat(1.25, 0, 0), quat(1.28, 0, 0), quat(1.65, 0, 0), quat(1.65, 0, 0), quat(1.6, 0, 0)]),
    qTrack('L_ForeArm', times, [quat(1.25, 0, 0), quat(1.28, 0, 0), quat(1.65, 0, 0), quat(1.65, 0, 0), quat(1.6, 0, 0)])
  ]);
}

// ==========================================
// 6. 胜负反馈与通用动作
// ==========================================

/**
 * 21. 获胜反馈 (1.0s 单次)
 * 身体前倾微握拳，点头认可
 */
export function makeReactWin() {
  const times = [0, 0.25, 0.5, 0.75, 1.0];
  return new THREE.AnimationClip('reactWin', 1.0, [
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.1, 0, 0), quat(0.12, 0, 0), quat(0.08, 0, 0), quat(0, 0, 0)]),
    qTrack('Head', times, [quat(0, 0, 0), quat(0.22, 0, 0), quat(-0.05, 0, 0), quat(0.12, 0, 0), quat(0, 0, 0)]),
    qTrack('R_UpperArm', times, [quat(0.15, 0, -0.1), quat(0.35, 0, -0.15), quat(0.45, 0, -0.15), quat(0.3, 0, -0.12), quat(0.15, 0, -0.1)]),
    qTrack('R_ForeArm', times, [quat(0.3, 0, 0), quat(1.2, 0, 0), quat(1.35, 0, 0), quat(1.0, 0, 0), quat(0.3, 0, 0)]),
    qTrack('R_Hand', times, [quat(0, 0, 0), quat(0.1, 0, -0.2), quat(0.15, 0, -0.25), quat(0.1, 0, -0.15), quat(0, 0, 0)]),
    qTrack('L_Hand', times, [quat(0, 0, 0), quat(0.05, 0, 0.1), quat(0.1, 0, 0.15), quat(0.05, 0, 0.1), quat(0, 0, 0)])
  ]);
}

/**
 * 22. 失败反馈 (1.0s 单次)
 * 摇头叹气 (头部 Y 轴旋转晃动)，肩膀塌下 (胸腔下沉)
 */
export function makeReactLose() {
  const times = [0, 0.18, 0.38, 0.58, 0.78, 1.0];
  return new THREE.AnimationClip('reactLose', 1.0, [
    vTrack('Chest', times, [[0, 0, 0], [0, -0.008, 0], [0, -0.014, 0], [0, -0.014, 0], [0, -0.012, 0], [0, -0.010, 0]]),
    qTrack('Spine', times, [quat(0, 0, 0), quat(0.08, 0, 0), quat(0.12, 0, 0), quat(0.12, 0, 0), quat(0.12, 0, 0), quat(0.10, 0, 0)]),
    qTrack('Head', times, [quat(0, 0, 0), quat(0.05, -0.24, 0), quat(0.08, 0.24, 0), quat(0.12, -0.16, 0), quat(0.15, 0.10, 0), quat(0.18, 0, 0)]),
    qTrack('R_UpperArm', times, [quat(0.1, 0, -0.1), quat(0.05, 0, -0.06), quat(0.02, 0, -0.04), quat(0.02, 0, -0.04), quat(0.02, 0, -0.04), quat(0.02, 0, -0.04)]),
    qTrack('L_UpperArm', times, [quat(0.1, 0, 0.1), quat(0.05, 0, 0.06), quat(0.02, 0, 0.04), quat(0.02, 0, 0.04), quat(0.02, 0, 0.04), quat(0.02, 0, 0.04)])
  ]);
}

/**
 * 23. 酒保擦酒杯/擦吧台 (3.0s 循环)
 * 左手持杯，右臂做规律的连续圆周擦拭动作
 */
export function makeBartenderWipe() {
  const steps = 30;
  const duration = 3.0;
  const times = [];
  const rUpper = [], rFore = [], rHand = [], spineRot = [];

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    times.push(t);
    const angle = 2 * Math.PI * (t / 1.0);
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    rUpper.push(quat(0.35 + 0.12 * sinA, -0.15 + 0.10 * cosA, -0.10 + 0.08 * sinA));
    rFore.push(quat(1.30 + 0.18 * cosA, 0.20 + 0.12 * sinA, 0));
    rHand.push(quat(0.10 + 0.15 * sinA, 0, 0.10 * cosA));
    spineRot.push(quat(0.04 + 0.01 * sinA, 0, 0));
  }

  return new THREE.AnimationClip('bartenderWipe', duration, [
    qTrack('R_UpperArm', times, rUpper),
    qTrack('R_ForeArm', times, rFore),
    qTrack('R_Hand', times, rHand),
    qTrack('Spine', times, spineRot),
    staticQ('L_UpperArm', times, quat(0.35, 0, 0.2)),
    staticQ('L_ForeArm', times, quat(1.35, 0.3, 0)),
    staticQ('L_Hand', times, quat(0.2, 0, 0)),
    staticQ('Head', times, quat(0.25, 0, 0))
  ]);
}

// ==========================================
// 动画剪辑懒加载工厂与缓存注册表
// ==========================================

const CLIP_FACTORIES = {
  idle: makeIdle,
  makeIdle,
  walk: makeWalk,
  makeWalk,
  idleLean: makeIdleLean,
  makeIdleLean,
  sitIdle: makeSitIdle,
  makeSitIdle,
  poolStance: makePoolStance,
  makePoolStance,
  poolStroke: makePoolStroke,
  makePoolStroke,
  poolWatch: makePoolWatch,
  makePoolWatch,
  dartStance: makeDartStance,
  makeDartStance,
  dartThrow: makeDartThrow,
  makeDartThrow,
  dartCelebrate: makeDartCelebrate,
  makeDartCelebrate,
  gunPickup: makeGunPickup,
  makeGunPickup,
  gunAimTemple: makeGunAimTemple,
  makeGunAimTemple,
  gunTrigger: makeGunTrigger,
  makeGunTrigger,
  gunClickRelief: makeGunClickRelief,
  makeGunClickRelief,
  gunBangRecoil: makeGunBangRecoil,
  makeGunBangRecoil,
  gunPutdown: makeGunPutdown,
  makeGunPutdown,
  gunSpinCylinder: makeGunSpinCylinder,
  makeGunSpinCylinder,
  diceRoll: makeDiceRoll,
  makeDiceRoll,
  diceCupsShake: makeDiceCupsShake,
  makeDiceCupsShake,
  diceCupsLift: makeDiceCupsLift,
  makeDiceCupsLift,
  reactWin: makeReactWin,
  makeReactWin,
  reactLose: makeReactLose,
  makeReactLose,
  bartenderWipe: makeBartenderWipe,
  makeBartenderWipe
};

const clipCache = new Map();

/**
 * 按名称懒加载并缓存获取 THREE.AnimationClip 实例
 * 支持标准动作名 (如 'idle') 或函数名 (如 'makeIdle')
 * @param {string} name
 * @returns {THREE.AnimationClip|null}
 */
export function getClip(name) {
  if (typeof name !== 'string') return null;
  if (clipCache.has(name)) {
    return clipCache.get(name);
  }

  // 尝试直接匹配、下划线转驼峰或首字母小写规范化
  let normalized = name;
  let factory = CLIP_FACTORIES[normalized];
  if (!factory) {
    const camel = name.replace(/_([a-z0-9])/g, (_, l) => l.toUpperCase());
    if (CLIP_FACTORIES[camel]) factory = CLIP_FACTORIES[camel];
  }
  if (!factory && name.length > 0) {
    const lowerFirst = name.charAt(0).toLowerCase() + name.slice(1);
    if (CLIP_FACTORIES[lowerFirst]) {
      normalized = lowerFirst;
      factory = CLIP_FACTORIES[lowerFirst];
    }
  }

  if (!factory) {
    console.warn(`[avatarAnims] 未知的动画剪辑名称: "${name}"`);
    return null;
  }

  // 若该工厂对应的任意别名已被缓存，直接复用
  for (const [key, clip] of clipCache.entries()) {
    if (CLIP_FACTORIES[key] === factory) {
      clipCache.set(name, clip);
      return clip;
    }
  }

  const clip = factory();
  clipCache.set(name, clip);
  if (clip && clip.name) {
    clipCache.set(clip.name, clip);
    const makeName = 'make' + clip.name.charAt(0).toUpperCase() + clip.name.slice(1);
    clipCache.set(makeName, clip);
  }

  return clip;
}
