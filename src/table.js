// 桌面与球的常量（单位：米）。x 沿长边，z 沿短边，y 向上，台面顶面 y = 0。
// 中式八球 9 尺台：台面内尺寸约 2.54 × 1.27 m。

export const BALL_R = 0.0286;            // 57.2 mm 标准球
export const BALL_MASS = 0.17;           // kg
export const TABLE_L = 2.54;             // 台面长（库边内沿到内沿）
export const TABLE_W = 1.27;             // 台面宽
export const HALF_L = TABLE_L / 2;
export const HALF_W = TABLE_W / 2;

export const CUSHION_H = 0.037;          // 库边高（约 0.64 球径处接触）
export const CUSHION_T = 0.12;           // 库边碰撞体厚度（向外）
export const RAIL_TOP = 0.045;           // 木框上沿高度（视觉用）

// 袋口：角袋与中袋。capture 为落袋判定半径（球心进入即落袋）。
export const POCKETS = [
  { id: 0, x: -HALF_L, z: -HALF_W, kind: 'corner', capture: 0.075 },
  { id: 1, x: 0,       z: -HALF_W, kind: 'side',   capture: 0.068 },
  { id: 2, x: HALF_L,  z: -HALF_W, kind: 'corner', capture: 0.075 },
  { id: 3, x: -HALF_L, z: HALF_W,  kind: 'corner', capture: 0.075 },
  { id: 4, x: 0,       z: HALF_W,  kind: 'side',   capture: 0.068 },
  { id: 5, x: HALF_L,  z: HALF_W,  kind: 'corner', capture: 0.075 },
];

// 袋口开口宽度（库边在此处断开）
export const CORNER_MOUTH = 0.115;       // 角袋沿库边方向留出的缺口
export const SIDE_MOUTH = 0.105;         // 中袋缺口半宽

export const HEAD_SPOT = { x: -HALF_L / 2, z: 0 };   // 开球线中点（置球点）
export const FOOT_SPOT = { x: HALF_L / 2, z: 0 };    // 置球点（球堆顶球位置）

// 球号 → 颜色（中式八球：1-7 全色、8 黑、9-15 花色）
export const BALL_COLORS = {
  0: '#f4efe0',
  1: '#f2c230', 2: '#2f5fd0', 3: '#d63a2a', 4: '#7a3fb0',
  5: '#ee7a1c', 6: '#2f9a4a', 7: '#8a2a2a', 8: '#1a1a1a',
};
export function colorOf(n) {
  if (n === 0) return BALL_COLORS[0];
  return BALL_COLORS[n <= 8 ? n : n - 8];
}
export function groupOf(n) {
  if (n === 0) return 'cue';
  if (n === 8) return 'eight';
  return n < 8 ? 'solid' : 'stripe';
}

// 物理材质参数（组合规则取 Min，见 sim.js）
export const MAT = {
  ball:    { friction: 0.20, restitution: 0.93 },
  bed:     { friction: 0.20, restitution: 0.0 },
  cushion: { friction: 0.12, restitution: 0.72 },
};

export const PHYS = {
  dt: 1 / 240,
  rollDecel: 0.11,          // 滚动阻力（m/s²，恒定减速）
  spinDecel: 3.0,           // 纵轴自旋衰减（rad/s²）
  maxCueSpeed: 10.0,        // 满力杆速（m/s）
  minCueSpeed: 0.35,
  sleepSpeed: 0.012,        // 低于此线速度并且角速度小 → 视为静止
  sleepAngSpeed: 0.6,
};
