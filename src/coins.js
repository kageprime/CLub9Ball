// 俱乐部金币经济系统：持久化钱包 + 3D 场景金币拾取 + 小游戏奖惩 + 吧台消费。
// 统一俱乐部所有货币（台球、飞镖、骰子扑克、轮盘赌、国际象棋、吧台）。

export const DEFAULT_COINS = 100;
export const PICKUP_COOLDOWN = 60; // 拾取后 60 秒刷新

export const PICKUP_SPOTS = [
  { id: 'bar_back',     x: -3.2, y: 1.15, z: -2.3, value: 10 },
  { id: 'fireplace',    x: 0.5,  y: 0.85, z: 2.3,  value: 10 },
  { id: 'darts_side',   x: 1.3,  y: 0.85, z: 0.9,  value: 10 },
  { id: 'wine_shelf',   x: -2.2, y: 0.85, z: 2.2,  value: 10 },
  { id: 'dice_corner',  x: 3.4,  y: 0.85, z: -2.3, value: 10 },
  { id: 'chess_lounge', x: -2.8, y: 0.85, z: 0.9,  value: 10 },
];

export class CoinManager {
  constructor({ audio = null, onBalanceChange = null, onPickup = null } = {}) {
    this.audio = audio;
    this.onBalanceChange = onBalanceChange;
    this.onPickup = onPickup;

    let saved = null;
    try {
      const v = localStorage.getItem('club9.coins');
      if (v != null) saved = parseInt(v, 10);
    } catch (_) { /* 隐私模式 */ }
    this.balance = (saved != null && !Number.isNaN(saved)) ? saved : DEFAULT_COINS;

    this.pickups = PICKUP_SPOTS.map((s, idx) => ({
      ...s,
      active: true,
      respawnTimer: 0,
      bobPhase: (idx * Math.PI) / 3,
    }));
  }

  save() {
    try {
      localStorage.setItem('club9.coins', String(this.balance));
    } catch (_) { /* 隐私模式 */ }
  }

  canSpend(n) {
    return n > 0 && this.balance >= n;
  }

  spend(n, reason = '') {
    if (!this.canSpend(n)) return false;
    this.balance -= n;
    this.save();
    this.onBalanceChange?.(this.balance, -n, reason);
    return true;
  }

  earn(n, reason = '') {
    if (n <= 0) return;
    this.balance += n;
    this.save();
    this.audio?.play('coin');
    this.onBalanceChange?.(this.balance, +n, reason);
  }

  update(playerPos, dt = 0.016) {
    if (!playerPos) return;
    for (const p of this.pickups) {
      if (!p.active) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.active = true;
          p.respawnTimer = 0;
        }
        continue;
      }

      // 玩家走近 0.7 米判定拾取
      const dist = Math.hypot(playerPos.x - p.x, playerPos.z - p.z);
      if (dist < 0.7) {
        p.active = false;
        p.respawnTimer = PICKUP_COOLDOWN;
        this.earn(p.value, 'pickup');
        this.onPickup?.(p);
      }
    }
  }

  // 兼容原有 Chips 接口（用于骰子扑克 / 轮盘等）
  asChips() {
    return {
      get balance() { return this._cm.balance; },
      set balance(v) { this._cm.balance = v; this._cm.save(); },
      canBet: (n) => this.canSpend(n),
      bet: (n) => this.spend(n, 'bet'),
      pay: (n) => this.earn(n, 'win'),
      _cm: this,
    };
  }
}
