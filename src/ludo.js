// 飞行棋（Ludo Club）核心引擎与 3D 棋桌交互控制器。
// 规则：
//  • 52 格公共环道 + 4 色家园终点道（每色 5 格进家 + 终点三角）
//  • 掷出 6 点方可起飞进入起跑格，且掷出 6 奖励额外一掷
//  • 在非安全格上与敌方棋子重叠即为吃子，被吃棋子退回停机坪，吃子者获奖励一掷
//  • 精确掷点才能进入终点三角（step 56）
//  • 率先让全部棋子抵达终点者赢得全部底池金币
// 表现层：
//  • 纯 3D 棋桌体验（同骰子扑克）：摄像机俯视俱乐部胡桃木圆桌
//  • 3D 棋子具有平滑抛物线跳格动画、音效反馈、安全区光环、底座光圈
//  • 中心小盘内 3D 骰子真实翻滚落地，定格在掷出的点数朝上
//  • 屏幕投影 3D 标签（Projected HUD Tags），支持鼠标/触屏点选棋子与骰子

import * as THREE from 'three';
import { quatFaceUp } from './dice.js';

export const TRACK_LEN = 52;
export const SAFE_TILES = [0, 8, 13, 21, 26, 34, 39, 47];
export const PLAYER_CONFIGS = [
  { id: 0, color: 'red',    nameKey: 'ludo.p.red',    startTile: 0,  hex: 0xdc2626, css: '#dc2626' },
  { id: 1, color: 'green',  nameKey: 'ludo.p.green',  startTile: 13, hex: 0x16a34a, css: '#16a34a' },
  { id: 2, color: 'yellow', nameKey: 'ludo.p.yellow', startTile: 26, hex: 0xeab308, css: '#eab308' },
  { id: 3, color: 'blue',   nameKey: 'ludo.p.blue',   startTile: 39, hex: 0x2563eb, css: '#2563eb' },
];

export const TRACK_COORDS = [
  // 顶部红色起始区顺时针至右侧 (0..8)
  [6, 1], [6, 0], [7, 0], [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  // 右侧绿色起始区顺时针至下方 (9..21)
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7], [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  // 底部黄色起始区顺时针至左侧 (22..34)
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14], [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  // 左侧蓝色起始区顺时针至上方 (35..47)
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  // 接驳回顶部红道 (48..51)
  [6, 5], [6, 4], [6, 3], [6, 2],
];

export const HOME_COORDS = [
  // 红色（朝下行进至终点三角）
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  // 绿色（朝左行进至终点三角）
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
  // 黄色（朝上行进至终点三角）
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  // 蓝色（朝右行进至终点三角）
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
];

export const YARD_COORDS = [
  // 红色家园停机位 (与盘面圆孔精准同心)
  [[1.3, 1.3], [3.7, 1.3], [1.3, 3.7], [3.7, 3.7]],
  // 绿色家园停机位
  [[10.3, 1.3], [12.7, 1.3], [10.3, 3.7], [12.7, 3.7]],
  // 黄色家园停机位
  [[10.3, 10.3], [12.7, 10.3], [10.3, 12.7], [12.7, 12.7]],
  // 蓝色家园停机位
  [[1.3, 10.3], [3.7, 10.3], [1.3, 12.7], [3.7, 12.7]],
];

export function isSafeTile(tileIndex) {
  return SAFE_TILES.includes(tileIndex);
}

export function getTileForStep(playerIdx, step) {
  if (step < 0 || step > 50) return -1;
  const start = PLAYER_CONFIGS[playerIdx].startTile;
  return (start + step) % TRACK_LEN;
}

export function canTokenMove(token, roll) {
  if (!token || token.state === 'done') return false;
  if (token.state === 'yard') return roll === 6;
  if (token.step + roll > 56) return false;
  return true;
}

export function moveToken(token, roll) {
  const t = { ...token };
  if (t.state === 'yard') {
    if (roll === 6) {
      t.state = 'track';
      t.step = 0;
    }
    return { token: t, reachedHome: false };
  }
  const nextStep = t.step + roll;
  if (nextStep > 56) return { token: t, reachedHome: false };
  t.step = nextStep;
  if (nextStep === 56) {
    t.state = 'done';
    return { token: t, reachedHome: true };
  }
  if (nextStep > 50) {
    t.state = 'home';
  } else {
    t.state = 'track';
  }
  return { token: t, reachedHome: false };
}

export class LudoGame {
  constructor({ playerCount = 2, tokensPerPlayer = 2, stake = 15 } = {}) {
    this.playerCount = Math.max(2, Math.min(4, playerCount));
    this.tokensPerPlayer = Math.max(1, Math.min(4, tokensPerPlayer));
    this.stake = stake;
    this.currentTurn = 0; // 0: Red (Player), 1..3: CPUs
    this.rollResult = 0;
    this.consecutiveSixes = 0;
    this.winner = null;

    this.players = [];
    for (let p = 0; p < this.playerCount; p++) {
      const cfg = PLAYER_CONFIGS[p];
      const tokens = [];
      for (let i = 0; i < this.tokensPerPlayer; i++) {
        tokens.push({ id: i, player: p, state: 'yard', step: -1 });
      }
      this.players.push({
        ...cfg,
        isHuman: p === 0,
        tokens,
      });
    }
  }

  pot() {
    return this.stake * this.playerCount;
  }

  getMovableTokens(playerIdx, roll) {
    const p = this.players[playerIdx];
    if (!p) return [];
    return p.tokens.filter((t) => canTokenMove(t, roll));
  }

  applyMove(playerIdx, tokenIdx, roll) {
    const p = this.players[playerIdx];
    const token = p.tokens[tokenIdx];
    if (!canTokenMove(token, roll)) return { ok: false };

    const { token: nextToken, reachedHome } = moveToken(token, roll);
    p.tokens[tokenIdx] = nextToken;

    let captured = [];
    let extraRoll = roll === 6 || reachedHome;

    // 检查吃子：仅在主环道（step 0..50）且非安全格
    if (nextToken.state === 'track' && nextToken.step >= 0 && nextToken.step <= 50) {
      const tile = getTileForStep(playerIdx, nextToken.step);
      if (!isSafeTile(tile)) {
        for (let otherP = 0; otherP < this.playerCount; otherP++) {
          if (otherP === playerIdx) continue;
          for (const oppToken of this.players[otherP].tokens) {
            if (oppToken.state === 'track') {
              const oppTile = getTileForStep(otherP, oppToken.step);
              if (oppTile === tile) {
                // 吃子！送回基地
                oppToken.state = 'yard';
                oppToken.step = -1;
                captured.push({ player: otherP, token: oppToken.id });
                extraRoll = true;
              }
            }
          }
        }
      }
    }

    const win = this.checkWinner();
    if (win != null) this.winner = win;

    return {
      ok: true,
      token: nextToken,
      reachedHome,
      captured,
      extraRoll,
      winner: this.winner,
    };
  }

  shouldAdvanceTurn(roll, wasCaptureOrHome = false) {
    if (roll === 6 || wasCaptureOrHome) return false;
    return true;
  }

  advanceTurn() {
    this.consecutiveSixes = 0;
    this.currentTurn = (this.currentTurn + 1) % this.playerCount;
    return this.currentTurn;
  }

  checkWinner() {
    for (let i = 0; i < this.playerCount; i++) {
      if (this.players[i].tokens.every((t) => t.state === 'done')) {
        return i;
      }
    }
    return null;
  }

  // 电脑走棋策略评估
  chooseCpuMove(playerIdx, roll) {
    const movables = this.getMovableTokens(playerIdx, roll);
    if (!movables.length) return -1;
    if (movables.length === 1) return movables[0].id;

    let bestScore = -1e9;
    let bestTokenId = movables[0].id;

    for (const token of movables) {
      let score = 0;
      const targetStep = token.state === 'yard' ? 0 : token.step + roll;

      // 1. 到达终点
      if (targetStep === 56) score += 90;
      // 2. 基地出动
      else if (token.state === 'yard' && roll === 6) score += 60;
      // 3. 检查吃子机会
      else if (targetStep <= 50) {
        const targetTile = getTileForStep(playerIdx, targetStep);
        if (!isSafeTile(targetTile)) {
          for (let op = 0; op < this.playerCount; op++) {
            if (op === playerIdx) continue;
            for (const ot of this.players[op].tokens) {
              if (ot.state === 'track' && getTileForStep(op, ot.step) === targetTile) {
                score += 120; // 优先吃子！
              }
            }
          }
        }
        // 4. 进入安全格
        if (isSafeTile(targetTile)) score += 35;
      }
      // 5. 走得越远分稍高（推进前线）
      score += targetStep * 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestTokenId = token.id;
      }
    }

    return bestTokenId;
  }
}

// ---------------------------------------------------------------- 3D 棋桌控制器
export function createLudoMini({ world, audio, coins, toast, unlock, t, $ }) {
  let game = null;
  let active = false;
  let isRolling = false;
  let currentRoll = 0;
  let stake = 15;
  let playerCount = 2;
  let tokensPerPlayer = 2;
  let bound = false;

  // 3D 棋子动画队列与骰子物理翻转
  let animatingToken = null; // { player, token, hops: [[gx, gz], ...], hopIdx, hopT, onComplete }
  let returningTokens = [];  // 被吃棋子飞回停机位的抛物线动画
  const dieAnim = {
    active: false,
    t: 0,
    dur: 0.65,
    face: 1,
    yaw: 0,
    rx: 0, ry: 0, rz: 0,
  };

  function tokenGridPos(token) {
    if (token.state === 'yard') {
      return YARD_COORDS[token.player][token.id];
    }
    if (token.state === 'track') {
      const tile = getTileForStep(token.player, token.step);
      return TRACK_COORDS[tile] || [7, 7];
    }
    if (token.state === 'home') {
      const idx = Math.min(5, Math.max(0, token.step - 51));
      return HOME_COORDS[token.player][idx];
    }
    // done 状态：围绕终点三角四周整齐排列
    const base = HOME_COORDS[token.player][5];
    const ang = (token.id / 4) * Math.PI * 2;
    return [base[0] + Math.cos(ang) * 0.45, base[1] + Math.sin(ang) * 0.45];
  }

  function getStepCoords(playerIdx, step) {
    if (step <= 50) {
      const tile = getTileForStep(playerIdx, step);
      return TRACK_COORDS[tile] || [7, 7];
    }
    const idx = Math.min(5, Math.max(0, step - 51));
    return HOME_COORDS[playerIdx][idx];
  }

  function renderUI() {
    if (!active || !game) return;
    const pot = game.pot();
    const curP = game.players[game.currentTurn];
    const isHumanTurn = curP.isHuman;

    const potEl = $('ludo-pot');
    if (potEl) potEl.textContent = `${pot} 🪙`;

    const turnEl = $('ludo-turn-info');
    if (turnEl) {
      const colorCss = curP.css;
      const name = t(curP.nameKey);
      turnEl.innerHTML = `<span class="ludo-turn-badge" style="background:${colorCss}"></span> <b>${name}</b> ${isHumanTurn ? t('ludo.turn.you') : t('ludo.turn.cpu')}`;
    }

    const rollBtn = $('ludo-roll-btn');
    if (rollBtn) {
      rollBtn.disabled = !isHumanTurn || isRolling || currentRoll > 0 || !!animatingToken;
      rollBtn.innerHTML = `🎲 ${t('ludo.rollDice')} [Space]`;
    }

    const diceNum = $('ludo-dice-num');
    if (diceNum) {
      const pip = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][currentRoll - 1] || '🎲';
      diceNum.textContent = currentRoll ? `${pip} ${currentRoll}` : pip;
    }
  }

  // 屏幕投影标签：跟随人类玩家当前可移动的 3D 棋子
  function placeTags() {
    if (!active || !world || !game) return;
    const cam = world.camera;
    const rct = world.canvas.getBoundingClientRect();
    const proj = (wp) => {
      const v = wp.clone().project(cam);
      return {
        x: rct.left + (v.x * 0.5 + 0.5) * rct.width,
        y: rct.top + (-v.y * 0.5 + 0.5) * rct.height,
        ok: v.z < 1,
      };
    };

    const tagsContainer = $('ludo-tags');
    if (!tagsContainer) return;
    const tagEls = tagsContainer.children;

    const curP = game.players[game.currentTurn];
    const canSelect = curP && curP.isHuman && currentRoll > 0 && !isRolling && !animatingToken;

    for (let i = 0; i < 4; i++) {
      const el = tagEls[i];
      if (!el) continue;
      const tok = curP?.tokens?.[i];
      if (!canSelect || !tok || !canTokenMove(tok, currentRoll)) {
        el.hidden = true;
        continue;
      }
      const tokMesh = world.ludoTokens[0]?.[i];
      if (!tokMesh || !tokMesh.visible) {
        el.hidden = true;
        continue;
      }
      const wp = world.ludoBoardGroup.localToWorld(tokMesh.position.clone().add(new THREE.Vector3(0, 0.048, 0)));
      const p = proj(wp);
      el.hidden = !p.ok;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      const label = tok.state === 'yard' ? `✈ FLY` : `+${currentRoll}`;
      el.textContent = label;
      el.onclick = () => executePlayerMove(tok.id);
    }
  }

  function bindEvents() {
    if (bound) return;
    bound = true;

    $('ludo-roll-btn')?.addEventListener('click', () => {
      if (!isRolling && game && game.players[game.currentTurn].isHuman && currentRoll === 0 && !animatingToken) {
        rollDice();
      }
    });

    $('ludo-close-btn')?.addEventListener('click', () => {
      leave();
    });

    $('ludo-mode-2p')?.addEventListener('click', () => {
      if (isRolling || animatingToken) return;
      playerCount = 2;
      $('ludo-mode-2p')?.classList.add('on');
      $('ludo-mode-4p')?.classList.remove('on');
      startNewGame();
    });

    $('ludo-mode-4p')?.addEventListener('click', () => {
      if (isRolling || animatingToken) return;
      playerCount = 4;
      $('ludo-mode-4p')?.classList.add('on');
      $('ludo-mode-2p')?.classList.remove('on');
      startNewGame();
    });

    $('ludo-quick-btn')?.addEventListener('click', () => {
      if (isRolling || animatingToken) return;
      tokensPerPlayer = tokensPerPlayer === 2 ? 4 : 2;
      $('ludo-quick-btn').textContent = tokensPerPlayer === 2 ? t('ludo.quickMode') : t('ludo.classicMode');
      startNewGame();
    });
  }

  function startNewGame() {
    if (!coins.spend(stake, 'ludo_stake')) {
      toast(t('coins.notEnough'), 1500);
      return;
    }
    game = new LudoGame({ playerCount, tokensPerPlayer, stake });
    currentRoll = 0;
    isRolling = false;
    animatingToken = null;
    returningTokens = [];
    $('ludo-result').hidden = true;

    // 重置 3D 棋子初始位置与可见度
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 4; i++) {
        const isUsed = p < playerCount && i < tokensPerPlayer;
        world.setLudoTokenVisible(p, i, isUsed);
        world.setLudoTokenGlow(p, i, false);
        if (isUsed) {
          const [gx, gz] = YARD_COORDS[p][i];
          const loc = world.ludoGridToLocal(gx, gz, 0.0085);
          world.setLudoTokenPos(p, i, loc.x, loc.y, loc.z);
        }
      }
    }

    // 重置 3D 骰子
    const q = quatFaceUp(1, 0);
    world.setLudoDie(1, 0, 0.032, 0, q.x, q.y, q.z, q.w);

    audio.play('place');
    renderUI();
  }

  function rollDice() {
    if (isRolling || !game || animatingToken) return;
    isRolling = true;
    audio.play('rattle');

    // 随机最终点数
    const roll = 1 + ((Math.random() * 6) | 0);
    dieAnim.active = true;
    dieAnim.t = 0;
    dieAnim.dur = 0.62;
    dieAnim.face = roll;
    dieAnim.yaw = Math.random() * Math.PI * 2;
    dieAnim.rx = (Math.random() * 20 - 10);
    dieAnim.ry = (Math.random() * 20 - 10);
    dieAnim.rz = (Math.random() * 20 - 10);

    const diceNum = $('ludo-dice-num');
    let ticks = 0;
    const interval = setInterval(() => {
      const temp = 1 + ((Math.random() * 6) | 0);
      if (diceNum) diceNum.textContent = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][temp - 1];
      ticks++;
      if (ticks >= 7) {
        clearInterval(interval);
      }
    }, 70);
  }

  function onDiceLanded(roll) {
    currentRoll = roll;
    isRolling = false;
    audio.play(roll === 6 ? 'cheer' : 'thud');
    renderUI();

    const curP = game.players[game.currentTurn];
    const movables = game.getMovableTokens(game.currentTurn, roll);

    if (!movables.length) {
      toast(t('ludo.noMoves'), 1100);
      setTimeout(() => {
        currentRoll = 0;
        game.advanceTurn();
        renderUI();
        checkCpuTurn();
      }, 1000);
      return;
    }

    if (curP.isHuman) {
      // 只有 1 枚可走时自动走，无需繁琐点击
      if (movables.length === 1) {
        setTimeout(() => executePlayerMove(movables[0].id), 400);
      }
    } else {
      // CPU 策略走棋
      setTimeout(() => {
        const tId = game.chooseCpuMove(game.currentTurn, roll);
        if (tId >= 0) executePlayerMove(tId);
      }, 650);
    }
  }

  function executePlayerMove(tokenId) {
    if (!game || currentRoll === 0 || animatingToken) return;
    const pIdx = game.currentTurn;
    const roll = currentRoll;
    const p = game.players[pIdx];
    const token = p.tokens[tokenId];

    if (!canTokenMove(token, roll)) return;

    // 构建逐格跳跃路径
    const hops = [];
    if (token.state === 'yard') {
      // 从停机坪跳到起跑点
      hops.push(getStepCoords(pIdx, 0));
    } else {
      for (let s = token.step + 1; s <= token.step + roll; s++) {
        hops.push(getStepCoords(pIdx, s));
      }
    }

    currentRoll = 0;
    renderUI();

    // 启动 3D 棋子跳格动画
    animatingToken = {
      player: pIdx,
      token: tokenId,
      hops,
      hopIdx: 0,
      hopT: 0,
      hopDur: 0.13,
      startLoc: world.ludoTokens[pIdx][tokenId].position.clone(),
      onComplete: () => {
        const res = game.applyMove(pIdx, tokenId, roll);
        if (!res.ok) return;

        // 处理被吃棋子回飞动画
        if (res.captured?.length) {
          audio.play('hit');
          toast(t('ludo.capturedMsg'), 1400);
          for (const cap of res.captured) {
            const [gx, gz] = YARD_COORDS[cap.player][cap.token];
            const destLoc = world.ludoGridToLocal(gx, gz, 0.0085);
            returningTokens.push({
              player: cap.player,
              token: cap.token,
              startLoc: world.ludoTokens[cap.player][cap.token].position.clone(),
              destLoc,
              t: 0,
              dur: 0.45,
            });
          }
        } else if (res.reachedHome) {
          audio.play('cheer');
        } else {
          audio.play('click');
        }

        if (res.winner != null) {
          renderUI();
          showResult(res.winner);
          return;
        }

        if (res.extraRoll) {
          toast(roll === 6 ? t('ludo.rolledSixBonus') : t('ludo.bonusRoll'), 1200);
        } else {
          game.advanceTurn();
        }

        renderUI();
        checkCpuTurn();
      },
    };
  }

  function showResult(winnerIdx) {
    const resEl = $('ludo-result');
    if (!resEl) return;
    const isWin = winnerIdx === 0;
    const wP = game.players[winnerIdx];
    const pot = game.pot();

    if (isWin) {
      audio.play('cheer');
      coins.earn(pot, 'ludo_win');
      unlock('ludoWin');
      resEl.className = 'panel win';
      resEl.innerHTML = `
        <div class="big">🏆 ${t('ludo.won')}</div>
        <div class="desc">${t('ludo.youWon', { n: pot })}</div>
        <button class="btn big" id="ludo-rematch-btn">${t('over.rematch')}</button>
      `;
    } else {
      audio.play('foul');
      resEl.className = 'panel lose';
      resEl.innerHTML = `
        <div class="big">💀 ${t('over.lose')}</div>
        <div class="desc">${t('ludo.cpuWon', { name: t(wP.nameKey) })}</div>
        <button class="btn big" id="ludo-rematch-btn">${t('over.rematch')}</button>
      `;
    }
    resEl.hidden = false;
    $('ludo-rematch-btn')?.addEventListener('click', () => {
      startNewGame();
    });
  }

  function checkCpuTurn() {
    if (!active || !game || game.winner != null || animatingToken) return;
    const curP = game.players[game.currentTurn];
    if (!curP.isHuman) {
      setTimeout(() => {
        if (active && !isRolling && !animatingToken) rollDice();
      }, 750);
    }
  }

  function enter() {
    bindEvents();
    active = true;

    try { document.exitPointerLock?.(); } catch (_) {}
    document.body.classList.add('free', 'in-mini');

    if (world?.avatars?.player) {
      world.avatars.player.group.visible = false;
    }

    // 启用 3D 飞行棋桌聚光灯
    world.setLudoActive?.(true);

    // 镜头正前方 42 度俯视整张 3D 飞行棋桌
    if (world) {
      world.setCameraTarget(world.ludoLocal(0, 0.62, 0.52), world.ludoLocal(0, 0, -0.04), { fov: 42, k: 8 });
    }

    const m = $('ludo-ui');
    if (m) m.hidden = false;

    startNewGame();
  }

  function leave() {
    if (!active) return;
    active = false;
    world.setLudoActive?.(false);

    const m = $('ludo-ui');
    if (m) m.hidden = true;
    document.body.classList.remove('in-mini');

    if (world?.avatars?.player) {
      world.avatars.player.group.visible = true;   // 离开后回到俯视漫步：小人始终可见
    }
  }

  function update(dt) {
    if (!active || !world) return;

    // 相机保持聚焦在 3D 棋桌
    world.setCameraTarget(world.ludoLocal(0, 0.62, 0.52), world.ludoLocal(0, 0, -0.04), { fov: 42, k: 5 });

    // 1. 3D 骰子翻滚物理动画
    if (dieAnim.active) {
      dieAnim.t += dt;
      const u = Math.min(1, dieAnim.t / dieAnim.dur);
      // 抛起落地竖向曲线
      const y = 0.032 + Math.sin(u * Math.PI) * 0.055 + Math.abs(Math.sin(u * 14)) * 0.008 * (1 - u);
      // 空间自由翻滚四元数
      if (u < 0.75) {
        const angX = dieAnim.t * dieAnim.rx;
        const angY = dieAnim.t * dieAnim.ry;
        const angZ = dieAnim.t * dieAnim.rz;
        const qRnd = new THREE.Quaternion().setFromEuler(new THREE.Euler(angX, angY, angZ));
        world.setLudoDie(dieAnim.face, 0, y, 0, qRnd.x, qRnd.y, qRnd.z, qRnd.w);
      } else {
        // 落地阶段四元数对准目标朝上点数
        const targetQ = quatFaceUp(dieAnim.face, dieAnim.yaw);
        const frac = (u - 0.75) / 0.25;
        const curQ = world.ludoDie.quaternion.clone();
        curQ.slerp(new THREE.Quaternion(targetQ.x, targetQ.y, targetQ.z, targetQ.w), frac);
        world.setLudoDie(dieAnim.face, 0, y, 0, curQ.x, curQ.y, curQ.z, curQ.w);
      }

      if (u >= 1) {
        dieAnim.active = false;
        const targetQ = quatFaceUp(dieAnim.face, dieAnim.yaw);
        world.setLudoDie(dieAnim.face, 0, 0.032, 0, targetQ.x, targetQ.y, targetQ.z, targetQ.w);
        onDiceLanded(dieAnim.face);
      }
    }

    // 2. 3D 棋子跳格动画
    if (animatingToken) {
      const at = animatingToken;
      at.hopT += dt;
      const u = Math.min(1, at.hopT / at.hopDur);

      const targetCoord = at.hops[at.hopIdx];
      const targetLoc = world.ludoGridToLocal(targetCoord[0], targetCoord[1], 0.0085);

      const curX = THREE.MathUtils.lerp(at.startLoc.x, targetLoc.x, u);
      const curZ = THREE.MathUtils.lerp(at.startLoc.z, targetLoc.z, u);
      const curY = 0.0085 + Math.sin(u * Math.PI) * 0.036;

      world.setLudoTokenPos(at.player, at.token, curX, curY, curZ);

      if (u >= 1) {
        audio.play('click', { gain: 0.45 });
        at.startLoc.copy(targetLoc);
        at.hopT = 0;
        at.hopIdx++;
        if (at.hopIdx >= at.hops.length) {
          const cb = at.onComplete;
          animatingToken = null;
          cb?.();
        }
      }
    }

    // 3. 被吃棋子抛物线飞回停机位动画
    if (returningTokens.length) {
      for (let i = returningTokens.length - 1; i >= 0; i--) {
        const rt = returningTokens[i];
        rt.t += dt;
        const u = Math.min(1, rt.t / rt.dur);
        const curX = THREE.MathUtils.lerp(rt.startLoc.x, rt.destLoc.x, u);
        const curZ = THREE.MathUtils.lerp(rt.startLoc.z, rt.destLoc.z, u);
        const curY = 0.0085 + Math.sin(u * Math.PI) * 0.075;
        world.setLudoTokenPos(rt.player, rt.token, curX, curY, curZ);
        if (u >= 1) {
          world.setLudoTokenPos(rt.player, rt.token, rt.destLoc.x, rt.destLoc.y, rt.destLoc.z);
          returningTokens.splice(i, 1);
        }
      }
    }

    // 4. 同步棋子底座光圈状态（仅可行动的玩家棋子亮起）
    if (game && !animatingToken) {
      const curP = game.players[game.currentTurn];
      const isHuman = curP && curP.isHuman;
      for (let p = 0; p < 4; p++) {
        for (let i = 0; i < 4; i++) {
          const tok = game.players[p]?.tokens?.[i];
          const isMovable = isHuman && p === 0 && currentRoll > 0 && canTokenMove(tok, currentRoll);
          world.setLudoTokenGlow(p, i, isMovable);
        }
      }
    }

    placeTags();
  }

  function onCanvasClick(screenX, screenY) {
    if (!active || !game || animatingToken) return;
    const curP = game.players[game.currentTurn];
    if (!curP.isHuman) return;

    // 掷骰阶段：点击中心小盘或骰子直接投掷
    if (currentRoll === 0 && !isRolling) {
      rollDice();
      return;
    }

    // 走棋阶段：3D 射线拾取棋子
    if (currentRoll > 0) {
      const hit = world.raycastLudoToken(screenX, screenY);
      if (hit && hit.player === 0) {
        executePlayerMove(hit.token);
      }
    }
  }

  return {
    enter,
    leave,
    onCanvasClick,
    onKey(code) {
      if (code === 'Space' || code === 'Enter') {
        if (!isRolling && game && game.players[game.currentTurn].isHuman && currentRoll === 0 && !animatingToken) {
          rollDice();
        }
      } else if (code === 'KeyQ' || code === 'Escape') {
        leave();
      } else {
        // 数字键 1-4 直接走第 1-4 枚棋子
        const m = /^(?:Digit|Numpad)([1-4])$/.exec(code);
        if (m) {
          const tokId = +m[1] - 1;
          executePlayerMove(tokId);
        }
      }
    },
    update,
  };
}
