// 国际象棋展位与 Pixel Chess 迷你游戏嵌入控制器。
// 链接：https://chessnuts-nine.vercel.app/chess/index.html

import * as THREE from 'three';

export const DEFAULT_CHESS_URL = 'https://chessnuts-nine.vercel.app/chess/index.html';

export class ChessMini {
  constructor({ world, coins, onLeave = null } = {}) {
    this.world = world;
    this.coins = coins;
    this.onLeave = onLeave;
    this.active = false;
    this.playedThisSession = false;

    this.modalEl = document.getElementById('chess-modal');
    this.iframeEl = document.getElementById('chess-iframe');
    this.closeBtn = document.getElementById('chess-close');
    this.fsBtn = document.getElementById('chess-fs');

    this._bindEvents();
  }

  _bindEvents() {
    this.closeBtn?.addEventListener('click', () => {
      this.leave();
    });

    this.fsBtn?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        this.modalEl?.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });

    // 监听可能来自外部棋局的 postMessage（胜负结算等）
    window.addEventListener('message', (e) => {
      if (!this.active) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.type === 'CHESS_WIN') {
          this.coins?.earn(50, 'chess_win');
        } else if (data?.type === 'CHESS_DRAW') {
          this.coins?.earn(20, 'chess_draw');
        }
      } catch (_) { /* 忽略格式不符消息 */ }
    });
  }

  enter({ roomCode = null } = {}) {
    this.active = true;
    this.playedThisSession = false;

    // 释放指针锁，使鼠标可在棋盘界面点击拖拽
    try { document.exitPointerLock?.(); } catch (_) {}
    document.body.classList.add('free');

    // 隐藏第一人称玩家全身网格，避免遮挡镜头
    if (this.world?.avatars?.player) {
      this.world.avatars.player.group.visible = false;
    }

    // 镜头平滑坐进茶座单人椅
    if (this.world) {
      const eye = new THREE.Vector3(-2.8, 1.28, 1.18);
      const look = new THREE.Vector3(-2.8, 0.78, 1.82);
      this.world.setCameraTarget(eye, look, { fov: 52, k: 25 });
    }

    let url = DEFAULT_CHESS_URL;
    if (roomCode) {
      const glue = url.includes('?') ? '&' : '?';
      url += `${glue}room=${encodeURIComponent(roomCode)}`;
    }

    if (this.iframeEl && this.iframeEl.src !== url) {
      this.iframeEl.src = url;
    }

    if (this.modalEl) {
      this.modalEl.hidden = false;
    }
  }

  leave() {
    if (!this.active) return;
    this.active = false;

    if (this.modalEl) {
      this.modalEl.hidden = true;
    }

    // 每次在棋座体验可得对局参与奖励
    if (!this.playedThisSession) {
      this.playedThisSession = true;
      this.coins?.earn(15, 'chess_play');
    }

    this.onLeave?.();
  }

  onKey(code) {
    if (code === 'KeyQ' || code === 'Escape') {
      this.leave();
    }
  }
}
