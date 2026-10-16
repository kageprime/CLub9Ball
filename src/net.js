// 多人同游联机：基于 PeerJS (WebRTC P2P) 的无服务器点对点网络。
// 支持创建房间、加入房间、邀请链接（?room=xxx）、坐标广播、头顶聊天与台球同步。

const PEER_PREFIX = 'club9-v2-';

export class Network {
  constructor({ onConnected, onPlayerJoin, onPlayerState, onPlayerLeave, onChat, onPoolShot, onPoolPlace } = {}) {
    this.onConnected = onConnected;
    this.onPlayerJoin = onPlayerJoin;
    this.onPlayerState = onPlayerState;
    this.onPlayerLeave = onPlayerLeave;
    this.onChat = onChat;
    this.onPoolShot = onPoolShot;
    this.onPoolPlace = onPoolPlace;

    this.peer = null;
    this.isHost = false;
    this.roomCode = null;
    this.conns = new Map(); // peerId -> DataConnection
    this.myId = null;
    this.myName = 'Player_' + Math.floor(Math.random() * 899 + 100);
    this.myColor = [0x3a70c8, 0xd8302a, 0x2f9e44, 0xf59f00, 0x9c36b5, 0x0ca678][Math.floor(Math.random() * 6)];
  }

  async _ensurePeerJS() {
    if (window.Peer) return window.Peer;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
      s.onload = () => resolve(window.Peer);
      s.onerror = (e) => reject(new Error('Failed to load PeerJS from CDN'));
      document.head.appendChild(s);
    });
  }

  // 生成 4 位大写房间码
  static randomRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[(Math.random() * chars.length) | 0];
    return code;
  }

  // 创建房间（Host）
  async hostRoom(code = null) {
    await this._ensurePeerJS();
    this.leave();
    this.isHost = true;
    this.roomCode = (code || Network.randomRoomCode()).toUpperCase();

    const hostPeerId = `${PEER_PREFIX}${this.roomCode}-host`;
    this.peer = new window.Peer(hostPeerId, { debug: 1 });

    return new Promise((resolve, reject) => {
      this.peer.on('open', (id) => {
        this.myId = id;
        this.onConnected?.({ roomCode: this.roomCode, isHost: true });
        resolve(this.roomCode);
      });

      this.peer.on('connection', (conn) => {
        this._setupConn(conn);
      });

      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // 若 ID 冲突，换一个重试
          this.hostRoom().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  // 加入房间（Guest）
  async joinRoom(code) {
    await this._ensurePeerJS();
    this.leave();
    this.isHost = false;
    this.roomCode = code.trim().toUpperCase();

    const guestPeerId = `${PEER_PREFIX}${this.roomCode}-${Math.random().toString(36).slice(2, 7)}`;
    this.peer = new window.Peer(guestPeerId, { debug: 1 });

    return new Promise((resolve, reject) => {
      this.peer.on('open', (id) => {
        this.myId = id;
        const hostPeerId = `${PEER_PREFIX}${this.roomCode}-host`;
        const conn = this.peer.connect(hostPeerId, { reliable: true });
        this._setupConn(conn);

        conn.on('open', () => {
          this.onConnected?.({ roomCode: this.roomCode, isHost: false });
          // 发送问候
          conn.send({
            type: 'hello',
            name: this.myName,
            color: this.myColor,
          });
          resolve(this.roomCode);
        });

        conn.on('error', (err) => reject(err));
      });

      this.peer.on('error', (err) => reject(err));
    });
  }

  _setupConn(conn) {
    this.conns.set(conn.peer, conn);

    conn.on('data', (data) => {
      this._handleMsg(conn.peer, data);
    });

    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.onPlayerLeave?.({ id: conn.peer });
      if (this.isHost) {
        this.broadcast({ type: 'player_leave', id: conn.peer }, conn.peer);
      }
    });

    conn.on('error', () => {
      this.conns.delete(conn.peer);
    });

    if (this.isHost && conn.open) {
      conn.send({
        type: 'hello',
        name: this.myName,
        color: this.myColor,
      });
    }
  }

  _handleMsg(senderId, msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'hello':
        this.onPlayerJoin?.({ id: senderId, name: msg.name, color: msg.color });
        if (this.isHost) {
          // Host 转发新玩家给所有其他人
          this.broadcast({ type: 'player_join', id: senderId, name: msg.name, color: msg.color }, senderId);
        }
        break;

      case 'player_join':
        this.onPlayerJoin?.({ id: msg.id, name: msg.name, color: msg.color });
        break;

      case 'player_leave':
        this.onPlayerLeave?.({ id: msg.id });
        break;

      case 'state':
        this.onPlayerState?.({
          id: senderId,
          x: msg.x,
          z: msg.z,
          yaw: msg.yaw,
          act: msg.act,
          coins: msg.coins,
        });
        if (this.isHost) {
          // Host 路由给其他人
          this.broadcast(msg, senderId);
        }
        break;

      case 'chat':
        this.onChat?.({ id: senderId, name: msg.name, text: msg.text });
        if (this.isHost) {
          this.broadcast(msg, senderId);
        }
        break;

      case 'pool_shot':
        this.onPoolShot?.(msg);
        if (this.isHost) this.broadcast(msg, senderId);
        break;

      case 'pool_place':
        this.onPoolPlace?.(msg);
        if (this.isHost) this.broadcast(msg, senderId);
        break;

      default: break;
    }
  }

  broadcast(msg, excludePeerId = null) {
    for (const [peerId, conn] of this.conns.entries()) {
      if (excludePeerId && peerId === excludePeerId) continue;
      if (conn.open) {
        try { conn.send(msg); } catch (_) { /* 忽略网络微断 */ }
      }
    }
  }

  sendState({ x, z, yaw, act = 'walk', coins = 100 }) {
    if (!this.peer || this.conns.size === 0) return;
    this.broadcast({ type: 'state', x, z, yaw, act, coins });
  }

  sendChat(text) {
    if (!this.peer || !text) return;
    const msg = { type: 'chat', name: this.myName, text };
    this.broadcast(msg);
    this.onChat?.({ id: this.myId, name: this.myName, text, isMe: true });
  }

  sendPoolShot({ angle, power, sx, sy }) {
    if (!this.peer) return;
    this.broadcast({ type: 'pool_shot', angle, power, sx, sy });
  }

  sendPoolPlace({ x, z }) {
    if (!this.peer) return;
    this.broadcast({ type: 'pool_place', x, z });
  }

  leave() {
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
    this.roomCode = null;
    this.isHost = false;
  }
}
