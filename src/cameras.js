// 相机机位：只算“相机该在哪、看哪里”，不碰物理 / 渲染状态。main.js 每帧问它要目标，再交给 world.setCameraTarget 平滑跟随。
//
// 机位（CAMS）：
//   auto      自动：自己出手时在白球后方，电脑出手 / 球滚动时用转播机位
//   behind    球后第一人称视角（瞄准）；球滚动时从击球点后上方俯看
//   top       正上方俯视整张台
//   broadcast 转播机位：台边高处斜俯，缓慢跟随白球
//   side      低机位侧拍：贴着台边、顺着击球方向看
//   orbit     自由环绕：方向键转 / 俯仰，[ ] 推拉
//   chase     追球：瞄准时贴地近距离，球滚动时尾随白球
// 阶段（phase）：'aim' 瞄准中，'roll' 球在滚动。

import * as THREE from 'three';

export const CAMS = ['auto', 'behind', 'top', 'broadcast', 'side', 'orbit', 'chase', 'thirdPerson'];
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class CameraRig {
  constructor(tableY) {
    this.Y = tableY;
    this.mode = 'auto';
    this.orbit = { yaw: Math.PI / 2, pitch: 0.62, dist: 2.2 };
    this.chaseDir = new V3(1, 0, 0);
  }

  set(mode) { if (CAMS.includes(mode)) this.mode = mode; }
  next(step = 1) { this.mode = CAMS[(CAMS.indexOf(this.mode) + step + CAMS.length) % CAMS.length]; return this.mode; }
  nudgeOrbit(dyaw, dpitch, ddist) {
    const o = this.orbit;
    o.yaw += dyaw; o.pitch = clamp(o.pitch + dpitch, 0.12, 1.45); o.dist = clamp(o.dist + ddist, 0.9, 3.4);
  }

  // 自动机位解析为具体机位
  resolve(phase, cpuTurn) {
    if (this.mode !== 'auto') return this.mode;
    if (phase === 'roll') return 'broadcast';
    return cpuTurn ? 'broadcast' : 'behind';
  }

  // ctx：{ cue:{x,z}, angle, rollCam:{pos,look}, vel:{x,z}, dt }
  // 返回 { mode, pos, look, fov, k, lamps }（lamps：是否需要隐藏吊灯，避免挡镜头）
  compute(phase, cpuTurn, ctx) {
    const mode = this.resolve(phase, cpuTurn);
    const Y = this.Y, c = ctx.cue || { x: 0, z: 0 };
    const d = { x: Math.cos(ctx.angle || 0), z: Math.sin(ctx.angle || 0) };
    const r = { x: -d.z, z: d.x };
    let pos, look, fov = 55, k = 8, lamps = true;
    switch (mode) {
      case 'behind':
        if (phase === 'aim') {
          pos = new V3(c.x - d.x * 0.6, Y + 0.23, c.z - d.z * 0.6);
          look = new V3(c.x + d.x * 0.55, Y + 0.025, c.z + d.z * 0.55);
          fov = 52; k = 14;
        } else if (ctx.rollCam) { pos = ctx.rollCam.pos.clone(); look = ctx.rollCam.look.clone(); fov = 54; k = 6; }
        else { pos = new V3(c.x - d.x * 0.95, Y + 0.62, c.z - d.z * 0.95); look = new V3(c.x + d.x * 0.7, Y, c.z + d.z * 0.7); fov = 54; k = 6; }
        break;
      case 'top':
        pos = new V3(0, Y + 2.15, 0.34); look = new V3(0, Y, 0); fov = 50; k = 6; lamps = false;
        break;
      case 'broadcast': {
        const fx = c.x * 0.3;
        pos = new V3(fx * 1.1, Y + 1.15, 2.2); look = new V3(fx * 0.8, Y, 0.02); fov = 46; k = 3.5; lamps = false;
        break;
      }
      case 'side': {
        const s = r.z >= 0 ? 1 : -1;
        if (phase === 'aim') {
          pos = new V3(c.x + r.x * 0.5 * s - d.x * 0.2, Y + 0.17, c.z + r.z * 0.5 * s - d.z * 0.2);
          look = new V3(c.x + d.x * 0.85, Y + 0.03, c.z + d.z * 0.85); fov = 50; k = 10;
        } else {
          const m = ctx.rollMid || { x: c.x + d.x * 0.5, z: c.z + d.z * 0.5 };
          pos = new V3(m.x - d.x * 0.55 + r.x * 0.9 * s, Y + 0.34, m.z - d.z * 0.55 + r.z * 0.9 * s);
          look = new V3(m.x + d.x * 0.3, Y + 0.02, m.z + d.z * 0.3); fov = 56; k = 4;
        }
        break;
      }
      case 'orbit': {
        const o = this.orbit, cx = c.x * 0.3, cz = c.z * 0.3;
        pos = new V3(cx + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist, Y + Math.sin(o.pitch) * o.dist, cz + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist);
        look = new V3(cx, Y, cz); fov = 52; k = 9; lamps = pos.y - Y < 1.2;
        break;
      }
      case 'chase':
        if (phase === 'aim') {
          pos = new V3(c.x - d.x * 0.36, Y + 0.13, c.z - d.z * 0.36);
          look = new V3(c.x + d.x * 0.7, Y + 0.02, c.z + d.z * 0.7); fov = 62; k = 12;
        } else {
          const v = ctx.vel || { x: 0, z: 0 }, sp = Math.hypot(v.x, v.z);
          if (sp > 0.06) { const t = new V3(v.x / sp, 0, v.z / sp); this.chaseDir.lerp(t, 1 - Math.exp(-(ctx.dt || 0.016) * 4)).normalize(); }
          const cd = this.chaseDir;
          pos = new V3(c.x - cd.x * 0.5, Y + 0.26, c.z - cd.z * 0.5);
          look = new V3(c.x + cd.x * 0.45, Y + 0.02, c.z + cd.z * 0.45); fov = 60; k = 7;
        }
        break;
      case 'thirdPerson': {
        // 第三人称：跟在玩家身后上方
        const p = ctx.player || { x: 0, z: 0, yaw: 0 };
        const camDist = 2.2, camH = 1.9;
        const ox = -Math.cos(p.yaw) * camDist, oz = -Math.sin(p.yaw) * camDist;
        pos = new V3(p.x + ox, camH, p.z + oz);
        look = new V3(p.x, 1.4, p.z);
        fov = 58; k = 12; lamps = true;
        break;
      }
      default:
        pos = new V3(0, Y + 1.2, 2); look = new V3(0, Y, 0);
    }
    if (ctx.aspect && ctx.aspect < 1.0) {
      fov = Math.min(68, fov / Math.sqrt(ctx.aspect));
    }
    return { mode, pos, look, fov, k, lamps };
  }
}

export const CAM_KEYS = { Digit1: 'auto', Digit2: 'behind', Digit3: 'top', Digit4: 'broadcast', Digit5: 'side', Digit6: 'orbit', Digit7: 'chase', Digit8: 'thirdPerson' };
