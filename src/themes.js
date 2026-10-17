// 主题预设：纯数据，无依赖（可在 node 测试里直接 import）。
// classic = 此前校准过的暖吧灯（Ludo 亮度就是照这套调的）。
// neon    = 迈阿密霓虹夜（默认）：靛紫雾 + 日落背景 + 亮面地板 + 分区灯毯。
// world.js 的 applyTheme() 负责把预设应用到灯光/材质/后期上。

export const THEMES = {
  classic: {
    fog: { color: 0x241812, near: 8, far: 22 },
    clear: 0x18100c,
    sky: false, ground: null, palms: false,
    ambient: { color: 0x7a5a48, i: 0.70 },
    hemi: { sky: 0xffe4c4, ground: 0x281810, i: 0.45 },
    env: { loaded: 0.65, fallback: 0.38 },
    exposure: 1.25,
    spot: { color: 0xffe2b0, i: 55 },
    fire: { color: 0xff7a2a, i: 9 },
    lounge: { color: 0xffddb4, i: 4.5 },
    neon: [
      { color: 0xff3fb0, i: 5 },
      { color: 0x22d6e8, i: 4 },
      { color: 0xffa030, i: 3 },
    ],
    bulbs: [0xfff0c0, 0xfff0c0],
    floor: { roughness: 0.6, metalness: 0, env: 1.0 },
    zones: false,
  },
  neon: {
    fog: { color: 0x140a2e, near: 9, far: 26 },
    clear: 0x0d0620,
    sky: true, ground: 0x1a1030, palms: true,
    ambient: { color: 0x5a4a8a, i: 0.55 },
    hemi: { sky: 0xff8ad0, ground: 0x241040, i: 0.5 },
    env: { loaded: 0.55, fallback: 0.32 },
    exposure: 1.35,
    spot: { color: 0xffd6ee, i: 52 },
    fire: { color: 0xff7a2a, i: 9 },
    lounge: { color: 0xb44fff, i: 5 },
    neon: [
      { color: 0xff3fb0, i: 7 },
      { color: 0x22d6e8, i: 6 },
      { color: 0xffa030, i: 4 },
    ],
    bulbs: [0xff5ab8, 0x50e8ff],
    floor: { roughness: 0.22, metalness: 0.28, env: 1.35 },
    zones: true,
  },
};

// 分区灯毯（霓虹主题下显示在分区地面）：台球=桃粉 / 街机=青 / 赌场=紫 / 吧台=琥珀。
// 尺寸已与房间家具布局对齐：互不重叠、且都在房间内（见 themes 测试）。
// label 同时用于灯毯地贴文字与分区霓虹吊牌。
export const ZONES = [
  { key: 'pool',   label: 'POOL',   x: 0,     z: 0,     w: 3.3, d: 2.0, color: 0xff4fa8 },
  { key: 'arcade', label: 'ARCADE', x: 2.75,  z: 0.55,  w: 2.0, d: 2.9, color: 0x38e0ff },
  { key: 'casino', label: 'CASINO', x: -2.75, z: 0.15,  w: 2.2, d: 3.6, color: 0xb44fff },
  { key: 'bar',    label: 'BAR',    x: 0,     z: -2.15, w: 6.8, d: 0.9, color: 0xffb347 },
];
