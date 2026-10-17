import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LudoGame,
  TRACK_LEN,
  SAFE_TILES,
  getTileForStep,
  isSafeTile,
  canTokenMove,
  moveToken,
} from '../src/ludo.js';

describe('飞行棋（Ludo）：基础数据与棋盘规格', () => {
  it('棋盘由 52 格主环道和安全格组成', () => {
    assert.equal(TRACK_LEN, 52);
    assert.deepEqual(SAFE_TILES, [0, 8, 13, 21, 26, 34, 39, 47]);
    assert.ok(isSafeTile(0));
    assert.ok(isSafeTile(13));
    assert.ok(isSafeTile(26));
    assert.ok(isSafeTile(39));
    assert.ok(!isSafeTile(1));
    assert.ok(!isSafeTile(5));
  });

  it('不同颜色玩家的环道起始与坐标映射正确', () => {
    // 0: red (start 0), 1: green (start 13), 2: yellow (start 26), 3: blue (start 39)
    assert.equal(getTileForStep(0, 0), 0);
    assert.equal(getTileForStep(0, 10), 10);
    assert.equal(getTileForStep(1, 0), 13);
    assert.equal(getTileForStep(1, 10), 23);
    assert.equal(getTileForStep(2, 0), 26);
    assert.equal(getTileForStep(3, 0), 39);
    // 环道绕回
    assert.equal(getTileForStep(3, 14), (39 + 14) % 52); // 1
  });
});

describe('飞行棋（Ludo）：走棋规则与出子限制', () => {
  it('未掷出 6 时，停在基地的棋子不能出动', () => {
    const t = { id: 0, player: 0, state: 'yard', step: -1 };
    assert.equal(canTokenMove(t, 5), false);
    assert.equal(canTokenMove(t, 1), false);
    assert.equal(canTokenMove(t, 6), true);
  });

  it('掷出 6 时出子，进入起始格 step 0', () => {
    const t = { id: 0, player: 0, state: 'yard', step: -1 };
    const res = moveToken(t, 6);
    assert.equal(res.token.state, 'track');
    assert.equal(res.token.step, 0);
  });

  it('步数超过终点（step 56）时不能移动（需要精确掷点）', () => {
    const t = { id: 0, player: 0, state: 'home', step: 54 };
    assert.equal(canTokenMove(t, 3), false); // 54 + 3 = 57 > 56
    assert.equal(canTokenMove(t, 2), true);  // 54 + 2 = 56 (到达终点)
    assert.equal(canTokenMove(t, 1), true);  // 54 + 1 = 55
  });

  it('到达终点 56 后状态变为 done', () => {
    const t = { id: 0, player: 0, state: 'home', step: 54 };
    const res = moveToken(t, 2);
    assert.equal(res.token.state, 'done');
    assert.equal(res.token.step, 56);
  });
});

describe('飞行棋（Ludo）：吃子与安全区', () => {
  it('在普通格落入敌方棋子上方，敌方棋子被击回基地', () => {
    const game = new LudoGame({ playerCount: 2, tokensPerPlayer: 2, stake: 20 });
    // 强制设置：红方棋子在 step 13，绿方（从 13 出发）在 step 0（即世界 tile 13）
    // 红方 start=0, step 13 -> tile 13 (注意 tile 13 是安全格，所以我们用 tile 5)
    // 红方 step 5 -> tile 5. 绿方 start=13, 从 13 走 44 步绕回 tile 5: (13 + 44) % 52 = 5
    game.players[0].tokens[0] = { id: 0, player: 0, state: 'track', step: 5 };
    game.players[1].tokens[0] = { id: 0, player: 1, state: 'track', step: 44 };

    // 红方在 step 3 掷出 2 走上 step 5
    game.players[0].tokens[0].step = 3;
    const captureRes = game.applyMove(0, 0, 2);

    assert.equal(captureRes.captured.length, 1);
    assert.equal(captureRes.captured[0].player, 1);
    assert.equal(game.players[1].tokens[0].state, 'yard');
    assert.equal(game.players[1].tokens[0].step, -1);
    assert.equal(captureRes.extraRoll, true); // 吃子奖励重投
  });

  it('在安全格上敌方棋子不会被吃', () => {
    const game = new LudoGame({ playerCount: 2, tokensPerPlayer: 2, stake: 20 });
    // tile 8 是安全格 (SAFE_TILES: 0, 8, 13...)
    // 红方 step 8 -> tile 8
    // 绿方 step 47: (13 + 47) % 52 = 60 % 52 = 8
    game.players[0].tokens[0] = { id: 0, player: 0, state: 'track', step: 6 };
    game.players[1].tokens[0] = { id: 0, player: 1, state: 'track', step: 47 };

    const res = game.applyMove(0, 0, 2); // 红方从 6 走 2 到 step 8
    assert.equal(res.captured.length, 0);
    assert.equal(game.players[1].tokens[0].state, 'track'); // 未被吃
  });
});

describe('飞行棋（Ludo）：回合轮转与胜利结算', () => {
  it('掷出 6 获得额外一次投掷', () => {
    const game = new LudoGame({ playerCount: 2, tokensPerPlayer: 2, stake: 20 });
    game.currentTurn = 0;
    game.rollResult = 6;
    game.extraRoll = true;
    assert.equal(game.shouldAdvanceTurn(6, false), false);
  });

  it('所有棋子到达终点判定胜利', () => {
    const game = new LudoGame({ playerCount: 2, tokensPerPlayer: 2, stake: 20 });
    game.players[0].tokens[0] = { id: 0, player: 0, state: 'done', step: 56 };
    game.players[0].tokens[1] = { id: 1, player: 0, state: 'home', step: 55 };

    assert.equal(game.checkWinner(), null);
    game.applyMove(0, 1, 1); // 第二枚到达 56
    assert.equal(game.checkWinner(), 0);
  });
});
