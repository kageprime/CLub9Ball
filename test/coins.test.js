import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoinManager, DEFAULT_COINS, PICKUP_SPOTS } from '../src/coins.js';

test('金币管理：初始余额与存取', () => {
  const cm = new CoinManager();
  assert.equal(cm.balance, DEFAULT_COINS);
  assert.ok(cm.canSpend(50));
  assert.ok(!cm.canSpend(200));

  assert.ok(cm.spend(30));
  assert.equal(cm.balance, 70);

  cm.earn(50);
  assert.equal(cm.balance, 120);

  assert.ok(!cm.spend(150), '余额不足不能扣除');
  assert.equal(cm.balance, 120);
});

test('金币管理：3D 拾取与冷却再生', () => {
  let picked = null;
  const cm = new CoinManager({
    onPickup: (p) => { picked = p; },
  });

  const spot = PICKUP_SPOTS[0];
  // 玩家在较远位置
  cm.update({ x: spot.x + 5, z: spot.z + 5 }, 0.1);
  assert.equal(picked, null);
  assert.equal(cm.balance, DEFAULT_COINS);

  // 玩家走近拾取点
  cm.update({ x: spot.x + 0.2, z: spot.z + 0.2 }, 0.1);
  assert.ok(picked != null);
  assert.equal(picked.id, spot.id);
  assert.equal(cm.balance, DEFAULT_COINS + 10);
  assert.equal(cm.pickups[0].active, false);

  // 冷却中再次走近不会重复拾取
  picked = null;
  cm.update({ x: spot.x, z: spot.z }, 1.0);
  assert.equal(picked, null);
  assert.equal(cm.balance, DEFAULT_COINS + 10);

  // 时间流逝超过冷却时间，金币重新激活
  cm.update({ x: spot.x + 5, z: spot.z + 5 }, 70);
  assert.equal(cm.pickups[0].active, true);
});

test('金币管理：兼容 Chips 接口', () => {
  const cm = new CoinManager();
  const chips = cm.asChips();
  assert.equal(chips.balance, DEFAULT_COINS);
  assert.ok(chips.bet(20));
  assert.equal(cm.balance, DEFAULT_COINS - 20);
  chips.pay(40);
  assert.equal(cm.balance, DEFAULT_COINS + 20);
});
