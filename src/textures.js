// 程序化 Canvas 纹理：呢绒、球面号码、地板、墙面、木纹、砖、霓虹、镖盘。
// 全部使用确定性 PRNG（mulberry32，固定种子），每次加载像素完全一致。
// 画布分辨率故意很低，配合 NearestFilter 得到像素风。

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

function toTex(c, { repeat = null, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  tex.anisotropy = 1;
  return tex;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

// 呢绒：整张台面一张图（含置球点、开球线、中心磨损亮斑），256×128 对应 2.54×1.27 m
export function makeFelt(seed = 101) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#1d7a37'; g.fillRect(0, 0, 256, 128);
  // 像素噪点
  for (let i = 0; i < 5200; i++) {
    const x = (rng() * 256) | 0, y = (rng() * 128) | 0;
    g.fillStyle = rng() < 0.5 ? '#1a7032' : '#23853f';
    g.fillRect(x, y, 1, 1);
  }
  // 中心磨损亮斑（椭圆，阶梯边）
  for (let ring = 0; ring < 4; ring++) {
    g.fillStyle = `rgba(60,170,80,${0.07 + ring * 0.01})`;
    g.beginPath();
    g.ellipse(128, 64, 74 - ring * 12, 36 - ring * 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 开球线（头弦）与置球点
  g.fillStyle = 'rgba(210,235,210,0.12)';
  g.fillRect(64, 0, 1, 128);
  g.fillStyle = '#d8ead8';
  for (const [px, py] of [[64, 64], [192, 64]]) g.fillRect(px - 1, py - 1, 2, 2);
  return toTex(c);
}

// 木纹（Poly Haven 胡桃木缺失时的兜底）
export function makeWalnut(seed = 202, { w = 128, h = 64 } = {}) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(w, h);
  const base = ['#4a2c17', '#573320', '#3f2413', '#5d3a22'];
  for (let y = 0; y < h; y++) {
    const band = base[Math.floor(y / 4 + rng() * 0.8) % base.length];
    g.fillStyle = band; g.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < 260; i++) {
    const x = (rng() * w) | 0, y = (rng() * h) | 0, len = 4 + ((rng() * 22) | 0);
    g.fillStyle = rng() < 0.5 ? 'rgba(20,10,4,0.45)' : 'rgba(150,95,55,0.35)';
    g.fillRect(x, y, len, 1);
  }
  return toTex(c, { repeat: [1, 1] });
}

export function makeFloor(seed = 303) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(128, 128);
  const tones = ['#5b3a20', '#664225', '#50321b', '#6e482a'];
  const plank = 16;
  for (let row = 0; row < 128 / plank; row++) {
    let x = -((rng() * 64) | 0);
    while (x < 128) {
      const len = 48 + ((rng() * 40) | 0);
      g.fillStyle = tones[(rng() * tones.length) | 0];
      g.fillRect(x, row * plank, len, plank);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x, row * plank, len, 1);
      g.fillRect(x, row * plank, 1, plank);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,200,140,0.10)';
        g.fillRect(x + ((rng() * len) | 0), row * plank + ((rng() * plank) | 0), 3 + ((rng() * 8) | 0), 1);
      }
      x += len;
    }
  }
  return toTex(c, { repeat: [5, 4] });
}

export function makeWall(seed = 404) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(64, 128);
  // 上：暖色灰泥；下：护墙板
  g.fillStyle = '#7a5334'; g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,220,170,0.08)';
    g.fillRect((rng() * 64) | 0, (rng() * 80) | 0, 1, 1);
  }
  g.fillStyle = '#3b2415'; g.fillRect(0, 80, 64, 48);
  g.fillStyle = '#2a190d'; g.fillRect(0, 78, 64, 3);
  for (let x = 0; x < 64; x += 16) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, 82, 1, 46); }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = 'rgba(120,70,40,0.25)';
    g.fillRect((rng() * 64) | 0, 82 + ((rng() * 44) | 0), 1, 3 + ((rng() * 6) | 0));
  }
  return toTex(c, { repeat: [4, 1] });
}

export function makeBrick(seed = 505) {
  const rng = mulberry32(seed);
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#2a1a12'; g.fillRect(0, 0, 64, 64);
  const tones = ['#9a4a2a', '#8a4024', '#a85a34', '#7a3820'];
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 8 : 0;
    for (let x = -off; x < 64; x += 16) {
      g.fillStyle = tones[(rng() * tones.length) | 0];
      g.fillRect(x + 1, row * 8 + 1, 14, 6);
    }
  }
  return toTex(c, { repeat: [3, 3] });
}

// 球面：等距柱状展开 128×64。n=0 母球；1-8 全色；9-15 花色。号码圆牌在 u=0.25 与 0.75（前后各一）。
export function makeBallTexture(n) {
  const [c, g] = canvas(128, 64);
  const col = colorOf(n);
  const stripe = n > 8;
  if (n === 0) {
    g.fillStyle = '#f2ecda'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#c93a2a'; // 母球一个小红点方便看旋转
    g.fillRect(31, 31, 2, 2); g.fillRect(95, 31, 2, 2);
    return toTex(c);
  }
  if (stripe) {
    g.fillStyle = '#f2ecda'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = col; g.fillRect(0, 16, 128, 32);
    g.fillStyle = shade(col, 0.75); g.fillRect(0, 16, 128, 2); g.fillRect(0, 46, 128, 2);
  } else {
    g.fillStyle = col; g.fillRect(0, 0, 128, 64);
  }
  for (const cx of [32, 96]) {
    g.fillStyle = '#f6f1e2';
    for (let dy = -9; dy <= 9; dy++) {
      const half = Math.floor(Math.sqrt(81 - dy * dy));
      g.fillRect(cx - half, 32 + dy, half * 2 + 1, 1);
    }
    g.fillStyle = '#111';
    g.font = 'bold 15px monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), cx + 0.5, 33);
  }
  return toTex(c);
}

// 霓虹招牌：“九号俱乐部 / CLUB No.9”，低分辨率绘制
export function makeNeonSign() {
  const [c, g] = canvas(256, 96);
  g.fillStyle = '#0c1020'; g.fillRect(0, 0, 256, 96);
  // 外框：青 + 品红
  const frame = (inset, color) => {
    g.strokeStyle = color; g.lineWidth = 2;
    g.strokeRect(inset, inset, 256 - inset * 2, 96 - inset * 2);
  };
  frame(2, '#22d6e8'); frame(6, '#d84fe0');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const cjk = '"Noto Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Micro Hei",sans-serif';
  g.font = `bold 34px ${cjk}`;
  g.shadowColor = '#ffb020'; g.shadowBlur = 6; g.fillStyle = '#ffd36a';
  g.fillText('九号俱乐部', 128, 34);
  g.shadowBlur = 5;
  g.font = 'bold 22px monospace';
  g.shadowColor = '#22ff99'; g.fillStyle = '#7dffbf'; g.fillText('CLUB', 96, 71);
  g.shadowColor = '#ff4fa0'; g.fillStyle = '#ff8cc4'; g.fillText('No.9', 170, 71);
  g.shadowBlur = 0;
  return toTex(c);
}

export function makeOpenSign() {
  const [c, g] = canvas(64, 32);
  g.fillStyle = '#10142a'; g.fillRect(0, 0, 64, 32);
  g.strokeStyle = '#b05cff'; g.lineWidth = 2; g.strokeRect(2, 2, 60, 28);
  g.fillStyle = '#ff6fd0'; g.shadowColor = '#ff2fb0'; g.shadowBlur = 4;
  g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('OPEN', 32, 17);
  return toTex(c);
}

// 标准镖盘面 256×256（俯视，20 在正上方，顺时针）
export function makeDartboard() {
  const S = 256, cx = S / 2, cy = S / 2;
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
    g.fillStyle = '#f0e8d0'; g.font = 'bold 13px monospace';
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
  const [c, g] = canvas(32, 32);
  g.fillStyle = '#16632d'; g.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 120; i++) { g.fillStyle = rng() < 0.5 ? '#135a29' : '#1b7035'; g.fillRect((rng() * 32) | 0, (rng() * 32) | 0, 1, 1); }
  return toTex(c, { repeat: [8, 1] });
}

// 球杆木纹：浅枫 + 胡桃把手（竖向）
export function makeCueTexture() {
  const [c, g] = canvas(16, 128);
  g.fillStyle = '#e2b878'; g.fillRect(0, 0, 16, 70);
  g.fillStyle = '#3d2314'; g.fillRect(0, 70, 16, 58);
  g.fillStyle = '#c99a58'; for (let y = 4; y < 70; y += 9) g.fillRect(3 + (y % 5), y, 2, 5);
  g.fillStyle = '#6a3d20'; g.fillRect(0, 96, 16, 3); g.fillRect(0, 120, 16, 3);
  return toTex(c);
}
