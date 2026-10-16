import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Avatar, createAvatar, DEFAULT_CONFIG, SKIN, HAIR_COLOR, CLOTH_COLOR } from '../src/avatar.js';

test('Avatar 构造与骨骼层级完整性', () => {
  const av = new Avatar();
  assert.ok(av.group instanceof THREE.Group, 'avatar 具有根 Group 节点');
  assert.ok(av.bones.Root, '必须具备 Root 骨骼');
  assert.ok(av.bones.Head, '必须具备 Head 骨骼');
  assert.ok(av.bones.L_Hand, '必须具备左手骨骼');
  assert.ok(av.bones.R_Hand, '必须具备右手骨骼');
  assert.ok(av.bones.L_Foot, '必须具备左脚骨骼');
  assert.ok(av.bones.R_Foot, '必须具备右脚骨骼');

  // 检查关键骨骼连接层级
  assert.equal(av.bones.Head.parent, av.bones.Neck);
  assert.equal(av.bones.Neck.parent, av.bones.Chest);
  assert.equal(av.bones.Chest.parent, av.bones.Spine);
  assert.equal(av.bones.Spine.parent, av.bones.Root);

  av.dispose();
});

test('Avatar 网格几何体与面数预算 (< 1200 三角面)', () => {
  const av = new Avatar({
    hair: 'pompadour',
    accessories: ['cap_forward', 'shades', 'watch_left', 'chain_gold'],
  });

  let triCount = 0;
  av.group.traverse((c) => {
    if (c.isMesh && c.geometry) {
      const geo = c.geometry;
      if (geo.index) {
        triCount += geo.index.count / 3;
      } else if (geo.attributes.position) {
        triCount += geo.attributes.position.count / 3;
      }
    }
  });

  assert.ok(triCount > 200, `网格面数应大于 200，实际: ${triCount}`);
  assert.ok(triCount < 1200, `网格面数应小于 1200，符合低多边形规范，实际: ${triCount}`);

  av.dispose();
});

test('Avatar 发型与配件排他与挂载测试', () => {
  const av = new Avatar({
    hair: 'buzz',
    accessories: ['cap_forward', 'beanie', 'shades', 'watch_left'],
  });

  // 帽子互斥：beanie 与 cap_forward 只能生效一个
  const accNames = av.accMeshes.map((m) => m.name);
  assert.ok(accNames.includes('acc_cap_forward'), 'cap_forward 应当被挂载');
  assert.ok(!accNames.includes('acc_beanie'), '同类帽子 beanie 应当被互斥过滤');
  assert.ok(accNames.includes('acc_shades'), '墨镜正常挂载');
  assert.ok(accNames.includes('acc_watch_left'), '手表正常挂载');

  // 手表应挂在左手骨骼
  const watch = av.accMeshes.find((m) => m.name === 'acc_watch_left');
  assert.equal(watch.parent, av.bones.L_Hand);

  av.dispose();
});

test('Avatar 第一人称与第三人称部件可见性控制', () => {
  const av = new Avatar({ accessories: ['shades', 'watch_left'] });

  // 默认第三人称：头部网格可见
  let headMesh = null;
  av.bones.Head.traverse((c) => { if (c.isMesh) headMesh = c; });
  assert.ok(headMesh && headMesh.visible, '第三人称下头部网格应可见');

  // 切换为第一人称
  av.setFirstPerson(true);
  assert.equal(headMesh.visible, false, '第一人称下躯干和头部网格应隐藏');

  // 手臂依然可见
  let armMesh = null;
  av.bones.R_ForeArm.traverse((c) => { if (c.isMesh) armMesh = c; });
  assert.ok(armMesh && armMesh.visible, '第一人称下手部网格依然可见');

  // 切回第三人称
  av.setFirstPerson(false);
  assert.equal(headMesh.visible, true, '切换回第三人称后头部重新可见');

  av.dispose();
});

test('Avatar 动画播放与更新', () => {
  const av = new Avatar();
  assert.doesNotThrow(() => {
    av.play('idle');
    av.update(0.016);
    av.play('walk');
    av.update(0.016);
    av.play('dart_throw');
    av.update(0.016);
    av.play('pool_stance');
    av.update(0.016);
  });
  av.dispose();
});

test('Avatar 角色预设与配置应用', () => {
  const player = createAvatar('player');
  const opponent = createAvatar('opponent');
  const dealer = createAvatar('dealer');
  const bartender = createAvatar('bartender');

  assert.ok(player && opponent && dealer && bartender);

  // 更改配置动态生效
  player.applyConfig({ skin: 'deep3', hair: 'mohawk', shirtColor: 'burgundy' });
  assert.equal(player.config.hair, 'mohawk');
  assert.equal(player.config.shirtColor, 'burgundy');

  player.dispose();
  opponent.dispose();
  dealer.dispose();
  bartender.dispose();
});
