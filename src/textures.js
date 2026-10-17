// 程序化 Canvas 纹理：呢绒、球面号码、地板、墙面、木纹、砖、霓虹、镖盘。
// 全部使用确定性 PRNG（mulberry32，固定种子），每次加载像素完全一致。
// 分辨率适中（256–512）：放大时 NearestFilter 保留像素颗粒（像素感主要来自低分辨率渲染目标），
// 缩小时走 mipmap + 各向异性过滤，消除远处台呢 / 地板 / 木饰面的闪动。

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { colorOf } from './table.js';
import { SECTORS, BOARD } from './darts.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function toTex(c, { repeat = null, srgb = true, aniso = 4 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;                 // 放大：硬像素
  tex.minFilter = THREE.NearestMipmapLinearFilter;     // 缩小：mipmap 混合，远处不闪
  tex.generateMipmaps = true;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  tex.anisotropy = aniso;
  return tex;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

// 呢绒：整张台面一张图（含置球点、开球线、中心磨损亮斑），512×256 对应 2.54×1.27 m
export function makeFelt(seed = 101) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#1d7a37'; g.fillRect(0, 0, 512, 256);
  // 像素噪点
  for (let i = 0; i < 20800; i++) {
    const x = (rng() * 512) | 0, y = (rng() * 256) | 0;
    g.fillStyle = rng() < 0.5 ? '#1a7032' : '#23853f';
    g.fillRect(x, y, 1, 1);
  }
  // 中心磨损亮斑（椭圆，阶梯边）
  for (let ring = 0; ring < 4; ring++) {
    g.fillStyle = `rgba(60,170,80,${0.07 + ring * 0.01})`;
    g.beginPath();
    g.ellipse(256, 128, 148 - ring * 24, 72 - ring * 12, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 开球线（头弦）与置球点
  g.fillStyle = 'rgba(210,235,210,0.12)';
  g.fillRect(128, 0, 2, 256);
  g.fillStyle = '#d8ead8';
  for (const [px, py] of [[128, 128], [384, 128]]) g.fillRect(px - 2, py - 2, 4, 4);
  return toTex(c);
}

// 木纹（Poly Haven 胡桃木缺失时的兜底）
export function makeWalnut(seed = 202, { w = 256, h = 128 } = {}) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(w, h);
  const base = ['#4a2c17', '#573320', '#3f2413', '#5d3a22'];
  for (let y = 0; y < h; y++) {
    const band = base[Math.floor(y / 8 + rng() * 0.8) % base.length];
    g.fillStyle = band; g.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < 1040; i++) {
    const x = (rng() * w) | 0, y = (rng() * h) | 0, len = 8 + ((rng() * 44) | 0);
    g.fillStyle = rng() < 0.5 ? 'rgba(20,10,4,0.45)' : 'rgba(150,95,55,0.35)';
    g.fillRect(x, y, len, 1);
  }
  return toTex(c, { repeat: [1, 1] });
}

export function makeFloor(seed = 303) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(256, 256);
  const tones = ['#5b3a20', '#664225', '#50321b', '#6e482a'];
  const plank = 32;
  for (let row = 0; row < 256 / plank; row++) {
    let x = -((rng() * 128) | 0);
    while (x < 256) {
      const len = 96 + ((rng() * 80) | 0);
      g.fillStyle = tones[(rng() * tones.length) | 0];
      g.fillRect(x, row * plank, len, plank);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x, row * plank, len, 2);
      g.fillRect(x, row * plank, 2, plank);
      for (let i = 0; i < 28; i++) {
        g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,200,140,0.10)';
        g.fillRect(x + ((rng() * len) | 0), row * plank + ((rng() * plank) | 0), 6 + ((rng() * 16) | 0), 2);
      }
      x += len;
    }
  }
  return toTex(c, { repeat: [5, 4] });
}

export function makeWall(seed = 404) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(128, 256);
  // 上：暖色灰泥；下：护墙板
  g.fillStyle = '#7a5334'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 3600; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,220,170,0.08)';
    g.fillRect((rng() * 128) | 0, (rng() * 160) | 0, 1, 1);
  }
  g.fillStyle = '#3b2415'; g.fillRect(0, 160, 128, 96);
  g.fillStyle = '#2a190d'; g.fillRect(0, 156, 128, 6);
  for (let x = 0; x < 128; x += 32) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, 164, 2, 92); }
  for (let i = 0; i < 640; i++) {
    g.fillStyle = 'rgba(120,70,40,0.25)';
    g.fillRect((rng() * 128) | 0, 164 + ((rng() * 88) | 0), 1, 6 + ((rng() * 12) | 0));
  }
  return toTex(c, { repeat: [4, 1] });
}

export function makeBrick(seed = 505) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#2a1a12'; g.fillRect(0, 0, 128, 128);
  const tones = ['#9a4a2a', '#8a4024', '#a85a34', '#7a3820'];
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 16 : 0;
    for (let x = -off; x < 128; x += 32) {
      g.fillStyle = tones[(rng() * tones.length) | 0];
      g.fillRect(x + 2, row * 16 + 2, 28, 12);
    }
  }
  return toTex(c, { repeat: [3, 3] });
}

// 球面：等距柱状展开 256×128。n=0 母球；1-8 全色；9-15 花色。号码圆牌在 u=0.25 与 0.75（前后各一）。
export function makeBallTexture(n) {
  const [c, g] = canvas(256, 128);
  const col = colorOf(n);
  const stripe = n > 8;
  if (n === 0) {
    g.fillStyle = '#f2ecda'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#c93a2a'; // 母球小红点，方便看旋转
    g.fillRect(62, 62, 4, 4); g.fillRect(190, 62, 4, 4);
    return toTex(c);
  }
  if (stripe) {
    g.fillStyle = '#f2ecda'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = col; g.fillRect(0, 32, 256, 64);
    g.fillStyle = shade(col, 0.75); g.fillRect(0, 32, 256, 3); g.fillRect(0, 93, 256, 3);
  } else {
    g.fillStyle = col; g.fillRect(0, 0, 256, 128);
  }
  for (const cx of [64, 192]) {
    g.fillStyle = '#f6f1e2';
    for (let dy = -18; dy <= 18; dy++) {
      const half = Math.floor(Math.sqrt(324 - dy * dy));
      g.fillRect(cx - half, 64 + dy, half * 2 + 1, 1);
    }
    g.fillStyle = '#111';
    g.font = 'bold 30px monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), cx + 1, 66);
  }
  return toTex(c);
}

// 霓虹招牌：“九号俱乐部 / CLUB No.9”
export function makeNeonSign() {
  const [c, g] = canvas(512, 192);
  g.fillStyle = '#0c1020'; g.fillRect(0, 0, 512, 192);
  // 外框：青 + 品红
  const frame = (inset, color) => {
    g.strokeStyle = color; g.lineWidth = 4;
    g.strokeRect(inset, inset, 512 - inset * 2, 192 - inset * 2);
  };
  frame(4, '#22d6e8'); frame(12, '#d84fe0');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const cjk = '"Noto Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Micro Hei",sans-serif';
  g.font = `bold 68px ${cjk}`;
  g.shadowColor = '#ffb020'; g.shadowBlur = 12; g.fillStyle = '#ffd36a';
  g.fillText('九号俱乐部', 256, 68);
  g.shadowBlur = 10;
  g.font = 'bold 44px monospace';
  g.shadowColor = '#22ff99'; g.fillStyle = '#7dffbf'; g.fillText('CLUB', 192, 142);
  g.shadowColor = '#ff4fa0'; g.fillStyle = '#ff8cc4'; g.fillText('No.9', 340, 142);
  g.shadowBlur = 0;
  return toTex(c);
}

export function makeOpenSign() {
  const [c, g] = canvas(128, 64);
  g.fillStyle = '#10142a'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#b05cff'; g.lineWidth = 4; g.strokeRect(4, 4, 120, 56);
  g.fillStyle = '#ff6fd0'; g.shadowColor = '#ff2fb0'; g.shadowBlur = 8;
  g.font = 'bold 36px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('OPEN', 64, 34);
  return toTex(c);
}

// 标准镖盘面 512×512（俯视，20 在正上方，顺时针）
export function makeDartboard() {
  const S = 512, cx = S / 2, cy = S / 2;
  const [c, g] = canvas(S, S);
  const scale = (S / 2) / BOARD.face;            // 像素/米
  g.fillStyle = '#111'; g.fillRect(0, 0, S, S);
  g.beginPath(); g.arc(cx, cy, BOARD.face * scale, 0, Math.PI * 2); g.fillStyle = '#16120e'; g.fill();
  const wedge = (r0, r1, a0, a1, color) => {
    g.beginPath();
    g.arc(cx, cy, r1 * scale, a0, a1);
    g.arc(cx, cy, r0 * scale, a1, a0, true);
    g.closePath(); g.fillStyle = color; g.fill();
  };
  for (let i = 0; i < 20; i++) {
    const a0 = -Math.PI / 2 + (i - 0.5) * (Math.PI / 10);
    const a1 = a0 + Math.PI / 10;
    const dark = i % 2 === 0;
    const single = dark ? '#1a1a1a' : '#e8d9b0';
    const ring = dark ? '#c0281c' : '#1c8a3a';
    wedge(BOARD.outerBull, BOARD.trebleIn, a0, a1, single);
    wedge(BOARD.trebleIn, BOARD.trebleOut, a0, a1, ring);
    wedge(BOARD.trebleOut, BOARD.doubleIn, a0, a1, single);
    wedge(BOARD.doubleIn, BOARD.doubleOut, a0, a1, ring);
    // 号码
    const am = a0 + Math.PI / 20;
    const rr = (BOARD.doubleOut + BOARD.face) / 2 * scale;
    g.fillStyle = '#f0e8d0'; g.font = 'bold 26px monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(SECTORS[i]), cx + Math.cos(am) * rr, cy + Math.sin(am) * rr);
  }
  g.beginPath(); g.arc(cx, cy, BOARD.outerBull * scale, 0, Math.PI * 2); g.fillStyle = '#1c8a3a'; g.fill();
  g.beginPath(); g.arc(cx, cy, BOARD.bull * scale, 0, Math.PI * 2); g.fillStyle = '#c0281c'; g.fill();
  return toTex(c);
}

// 台呢侧面 / 库边橡胶用的纯色小贴图（带一点噪点）
export function makeRubber(seed = 606) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#16632d'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 480; i++) { g.fillStyle = rng() < 0.5 ? '#135a29' : '#1b7035'; g.fillRect((rng() * 64) | 0, (rng() * 64) | 0, 1, 1); }
  return toTex(c, { repeat: [8, 1] });
}

// 球杆木纹：浅枫 + 胡桃把手（竖向）
export function makeCueTexture() {
  const [c, g] = canvas(32, 256);
  g.fillStyle = '#e2b878'; g.fillRect(0, 0, 32, 140);
  g.fillStyle = '#3d2314'; g.fillRect(0, 140, 32, 116);
  g.fillStyle = '#c99a58'; for (let y = 8; y < 140; y += 18) g.fillRect(6 + (y % 10), y, 4, 10);
  g.fillStyle = '#6a3d20'; g.fillRect(0, 192, 32, 6); g.fillRect(0, 240, 32, 6);
  return toTex(c);
}

// 迈阿密日落天空：作为 scene.background，等距镜头下出现在房间之外（屋外布景）
export function makeSky() {
  const [c, g] = canvas(160, 100);
  const grad = g.createLinearGradient(0, 0, 0, 100);
  grad.addColorStop(0.00, '#0b0530');
  grad.addColorStop(0.38, '#2a0e55');
  grad.addColorStop(0.60, '#7a1a72');
  grad.addColorStop(0.74, '#e0356a');
  grad.addColorStop(0.84, '#ff7a3a');
  grad.addColorStop(0.90, '#ffb85a');
  grad.addColorStop(1.00, '#1c0a30');
  g.fillStyle = grad; g.fillRect(0, 0, 160, 100);
  // 星星（像素点）与落日
  const rng = mulberry32(707);
  g.fillStyle = '#cfe8ff';
  for (let i = 0; i < 40; i++) g.fillRect((rng() * 160) | 0, (rng() * 34) | 0, 1, 1);
  g.fillStyle = '#ffd36a'; g.shadowColor = '#ff8a4a'; g.shadowBlur = 16;
  g.beginPath(); g.arc(122, 79, 9, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  return toTex(c);
}

// 棕榈剪影贴片：屋外装饰（正面朝等距镜头，粉色霓虹描边）
export function makePalm() {
  const [c, g] = canvas(128, 192);
  const dark = '#120a24';
  g.strokeStyle = dark; g.fillStyle = dark;
  g.shadowColor = '#ff3fb0'; g.shadowBlur = 7;
  g.lineCap = 'round';
  g.lineWidth = 9;                                    // 树干
  g.beginPath(); g.moveTo(66, 190); g.quadraticCurveTo(60, 132, 62, 84); g.stroke();
  g.lineWidth = 6;                                    // 叶冠
  const frond = (x1, y1, cx1, cy1) => { g.beginPath(); g.moveTo(62, 84); g.quadraticCurveTo(cx1, cy1, x1, y1); g.stroke(); };
  frond(26, 46, 40, 52); frond(12, 60, 30, 62); frond(6, 84, 26, 78); frond(14, 108, 30, 100);
  frond(102, 52, 88, 56); frond(118, 72, 98, 70); frond(116, 96, 96, 88);
  g.beginPath(); g.arc(62, 82, 7, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  return toTex(c);
}

// 分区灯毯：圆角霓虹描边 + 柔和内发光（迈阿密分区用，尺寸按米传入）
// label：地贴文字。旋转 45° —— 等距镜头（yaw 135°）下正好水平可读。
export function makeZoneRug(w = 224, h = 140, color = '#ff4fa8', label = '') {
  const [c, g] = canvas(w, h);
  const r = Math.min(26, h * 0.22), inset = 6;
  const round = (x, y, ww, hh, rr) => {
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + ww, y, x + ww, y + hh, rr);
    g.arcTo(x + ww, y + hh, x, y + hh, rr);
    g.arcTo(x, y + hh, x, y, rr);
    g.arcTo(x, y, x + ww, y, rr);
    g.closePath();
  };
  round(inset, inset, w - inset * 2, h - inset * 2, r);
  g.fillStyle = color; g.globalAlpha = 0.12; g.fill(); g.globalAlpha = 1;
  g.shadowColor = color; g.shadowBlur = 14;           // 外描边：霓虹光
  g.strokeStyle = color; g.lineWidth = 5;
  round(inset + 2.5, inset + 2.5, w - (inset + 2.5) * 2, h - (inset + 2.5) * 2, r);
  g.stroke();
  g.shadowBlur = 0;
  g.globalAlpha = 0.4; g.lineWidth = 2;               // 内描边：细线
  round(inset + 12, inset + 12, w - (inset + 12) * 2, h - (inset + 12) * 2, Math.max(6, r - 8));
  g.stroke();
  g.globalAlpha = 1;
  if (label) {                                        // 地贴文字（面向等距镜头）
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(Math.PI / 4);
    const fs = Math.max(18, Math.min(60, Math.round(Math.min(w, h * 2) * 0.15)));
    g.font = `bold ${fs}px monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 12;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(label, 0, 0);
    g.restore();
  }
  return toTex(c);
}

// 分区霓虹吊牌：深色板 + 霓虹描边 + 白炽字（正面纹理；背面另用暗板）
export function makeZoneSign(text = 'POOL', color = '#ff4fa8') {
  const W = 256, H = 88;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#090518'; g.fillRect(0, 0, W, H);
  g.shadowColor = color; g.shadowBlur = 10;           // 外框霓虹
  g.strokeStyle = color; g.lineWidth = 5;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.shadowBlur = 16; g.fillStyle = '#ffffff';         // 字：白芯 + 彩色光晕
  g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 2);
  g.shadowBlur = 0;
  return toTex(c);
}
