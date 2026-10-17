// 主题预设测试：两份预设形状一致；霓虹预设关键参数符合预期（靛紫雾、亮面地板、分区开启）；
// 分区灯毯几何（尺寸/位置）都在房间内、互不重叠，且与家具中心点对齐。
import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, ZONES } from '../src/themes.js';

const ROOM = { x0: -4.2, x1: 4.2, z0: -3.0, z1: 3.0 };

test('两份主题预设形状一致且参数齐全', () => {
  assert.deepEqual(Object.keys(THEMES.classic).sort(), Object.keys(THEMES.neon).sort());
  for (const t of Object.values(THEMES)) {
    assert.ok(t.fog && Number.isFinite(t.fog.near) && t.fog.far > t.fog.near);
    assert.ok(t.exposure > 0);
    assert.equal(t.neon.length, 3);
    assert.equal(t.bulbs.length, 2);
    assert.ok(t.floor.roughness > 0 && t.floor.roughness <= 1);
  }
});

test('霓虹主题：靛紫雾 + 亮面地板 + 天空/分区开启；经典主题保持哑光、无布景', () => {
  const n = THEMES.neon, c = THEMES.classic;
  assert.ok(((n.fog.color >> 16) & 255) < (n.fog.color & 255), '霓虹雾应偏蓝紫（b > r）');
  assert.ok(n.floor.roughness < c.floor.roughness, '霓虹地板应比经典更光滑');
  assert.ok(n.sky === true && n.zones === true && n.palms === true);
  assert.ok(c.sky === false && c.zones === false && c.palms === false);
});

test('分区灯毯：四区齐全、颜色各异、都在房间内、互不重叠', () => {
  assert.equal(ZONES.length, 4);
  assert.deepEqual(ZONES.map((z) => z.key).sort(), ['arcade', 'bar', 'casino', 'pool']);
  assert.equal(new Set(ZONES.map((z) => z.color)).size, 4);
  assert.equal(new Set(ZONES.map((z) => z.label)).size, 4, '吊牌/地贴文字应各不相同');
  for (const z of ZONES) {
    assert.ok(z.w > 0 && z.d > 0);
    assert.ok(z.label && z.label.length >= 3, `${z.key} 缺少吊牌文字`);
    assert.ok(z.x - z.w / 2 >= ROOM.x0 && z.x + z.w / 2 <= ROOM.x1, `${z.key} 灯毯超出房间 X`);
    assert.ok(z.z - z.d / 2 >= ROOM.z0 && z.z + z.d / 2 <= ROOM.z1, `${z.key} 灯毯超出房间 Z`);
  }
  const hit = (a, b) => a.x - a.w / 2 < b.x + b.w / 2 - 1e-9 && b.x - b.w / 2 < a.x + a.w / 2 - 1e-9
    && a.z - a.d / 2 < b.z + b.d / 2 - 1e-9 && b.z - b.d / 2 < a.z + a.d / 2 - 1e-9;
  for (let i = 0; i < ZONES.length; i++) {
    for (let j = i + 1; j < ZONES.length; j++) {
      assert.ok(!hit(ZONES[i], ZONES[j]), `${ZONES[i].key} 与 ${ZONES[j].key} 灯毯重叠`);
    }
  }
});

test('灯毯覆盖各分区道具：台球中心、骰子台、飞镖位、Ludo/象棋、吧台', () => {
  const near = (z, x, zz) => x >= z.x - z.w / 2 && x <= z.x + z.w / 2 && zz >= z.z - z.d / 2 && zz <= z.z + z.d / 2;
  const zone = (k) => ZONES.find((z) => z.key === k);
  assert.ok(near(zone('pool'), 0, 0));
  assert.ok(near(zone('arcade'), 2.85, -0.45), '骰子台应落在街机区');
  assert.ok(near(zone('arcade'), 1.85, 1.6), '飞镖位应落在街机区');
  assert.ok(near(zone('casino'), -2.85, -0.45), 'Ludo 桌应落在赌场区');
  assert.ok(near(zone('casino'), -2.8, 1.8), '象棋桌应落在赌场区');
  assert.ok(near(zone('bar'), 0, -2.18), '吧台应落在吧台区');
});
