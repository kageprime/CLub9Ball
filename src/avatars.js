// 远端玩家 3D 像素化身管理：外观渲染、平滑插值 (LERP)、头顶名牌与 3D 浮动聊天气泡。

import * as THREE from 'three';

export class AvatarManager {
  constructor(scene) {
    this.scene = scene;
    this.avatars = new Map(); // id -> AvatarInstance
  }

  addPlayer({ id, name = 'Player', color = 0x3a70c8 }) {
    if (this.avatars.has(id)) return;

    const group = new THREE.Group();
    this.scene.add(group);

    // 材质
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf5cda8, roughness: 0.6 });
    const suitMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e2025, roughness: 0.8 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.9 });

    // 身体 (高 1.6m 左右)
    // 躯干 (中心 y=1.0)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 0.2), suitMat);
    torso.position.y = 1.0; torso.castShadow = true; group.add(torso);

    // 头部 (中心 y=1.4)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), skinMat);
    head.position.y = 1.38; head.castShadow = true; group.add(head);

    // 头发 / 帽子
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.24), hairMat);
    hair.position.y = 1.48; group.add(hair);

    // 眼睛 (微型方块)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const sx of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), eyeMat);
      eye.position.set(sx, 1.38, 0.115); group.add(eye);
    }

    // 双腿
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, 0.14), darkMat);
    legL.position.set(-0.09, 0.46, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, 0.14), darkMat);
    legR.position.set(0.09, 0.46, 0); legR.castShadow = true; group.add(legR);

    // 双臂
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.12), suitMat);
    armL.position.set(-0.22, 0.98, 0); armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.12), suitMat);
    armR.position.set(0.22, 0.98, 0); armR.castShadow = true; group.add(armR);

    // 头顶名牌 Sprite
    const nameSprite = this._createNameSprite(name, 100);
    nameSprite.position.set(0, 1.85, 0);
    group.add(nameSprite);

    // 头顶 3D 聊天气泡 Sprite
    const bubbleSprite = this._createBubbleSprite();
    bubbleSprite.position.set(0, 2.25, 0);
    bubbleSprite.visible = false;
    group.add(bubbleSprite);

    const inst = {
      id,
      name,
      color,
      group,
      torso,
      head,
      legL,
      legR,
      armL,
      armR,
      nameSprite,
      bubbleSprite,
      pos: new THREE.Vector3(0, 0, 0),
      tgtPos: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      tgtYaw: 0,
      act: 'walk',
      coins: 100,
      walkPhase: 0,
      bubbleTimer: 0,
    };

    this.avatars.set(id, inst);
  }

  _createNameSprite(name, coins = 100) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');

    this._drawNameCanvas(ctx, name, coins);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(0.85, 0.22, 1);
    sp._canvas = canvas; sp._ctx = ctx; sp._tex = tex;
    return sp;
  }

  _drawNameCanvas(ctx, name, coins) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(10, 8, 6, 0.82)';
    ctx.strokeStyle = '#e0aa38';
    ctx.lineWidth = 3;
    ctx.fillRect(4, 8, 248, 48);
    ctx.strokeRect(4, 8, 248, 48);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${name} 🪙${coins}`, 128, 40);
  }

  _createBubbleSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.4, 0.46, 1);
    sp._canvas = canvas; sp._ctx = canvas.getContext('2d'); sp._tex = tex;
    return sp;
  }

  showChat(id, text) {
    const inst = this.avatars.get(id);
    if (!inst) return;

    const ctx = inst.bubbleSprite._ctx;
    ctx.clearRect(0, 0, 384, 128);

    // 绘制复古像素气泡背景
    ctx.fillStyle = '#fff8e8';
    ctx.strokeStyle = '#221a14';
    ctx.lineWidth = 4;
    ctx.fillRect(8, 8, 368, 96);
    ctx.strokeRect(8, 8, 368, 96);

    // 小三角形尾巴
    ctx.fillStyle = '#fff8e8';
    ctx.beginPath();
    ctx.moveTo(180, 104); ctx.lineTo(204, 104); ctx.lineTo(192, 122); ctx.fill();

    ctx.fillStyle = '#111';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';

    // 简易截断显示
    const display = text.length > 22 ? text.slice(0, 20) + '…' : text;
    ctx.fillText(display, 192, 62);

    inst.bubbleSprite._tex.needsUpdate = true;
    inst.bubbleSprite.visible = true;
    inst.bubbleTimer = 5.0; // 显示 5 秒
  }

  updatePlayerState({ id, x, z, yaw, act = 'walk', coins = 100 }) {
    let inst = this.avatars.get(id);
    if (!inst) {
      this.addPlayer({ id });
      inst = this.avatars.get(id);
    }
    if (!inst) return;

    inst.tgtPos.set(x, 0, z);
    inst.tgtYaw = yaw;
    inst.act = act;
    if (inst.coins !== coins) {
      inst.coins = coins;
      this._drawNameCanvas(inst.nameSprite._ctx, inst.name, coins);
      inst.nameSprite._tex.needsUpdate = true;
    }
  }

  removePlayer(id) {
    const inst = this.avatars.get(id);
    if (!inst) return;
    this.scene.remove(inst.group);
    this.avatars.delete(id);
  }

  update(dt) {
    for (const inst of this.avatars.values()) {
      // 坐标平滑 LERP
      const a = 1 - Math.exp(-dt * 15);
      inst.pos.lerp(inst.tgtPos, a);
      inst.group.position.set(inst.pos.x, 0, inst.pos.z);

      // 旋转平滑
      let dyaw = inst.tgtYaw - inst.yaw;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      inst.yaw += dyaw * a;
      inst.group.rotation.y = inst.yaw;

      // 行走腿部摇摆动画
      const distMoving = inst.pos.distanceTo(inst.tgtPos);
      if (distMoving > 0.02) {
        inst.walkPhase += dt * 10;
        const swing = Math.sin(inst.walkPhase) * 0.45;
        inst.legL.rotation.x = swing;
        inst.legR.rotation.x = -swing;
        inst.armL.rotation.x = -swing * 0.7;
        inst.armR.rotation.x = swing * 0.7;
      } else {
        inst.legL.rotation.x = 0;
        inst.legR.rotation.x = 0;
        inst.armL.rotation.x = 0;
        inst.armR.rotation.x = 0;
      }

      // 特殊姿态：瞄准或落座
      if (inst.act === 'aim') {
        inst.torso.rotation.x = 0.35;
        inst.head.rotation.x = -0.2;
      } else if (inst.act === 'chess') {
        inst.torso.position.y = 0.85;
        inst.legL.rotation.x = Math.PI / 2;
        inst.legR.rotation.x = Math.PI / 2;
      } else {
        inst.torso.rotation.x = 0;
        inst.head.rotation.x = 0;
        inst.torso.position.y = 1.0;
      }

      // 气泡倒计时
      if (inst.bubbleTimer > 0) {
        inst.bubbleTimer -= dt;
        if (inst.bubbleTimer <= 0) {
          inst.bubbleSprite.visible = false;
        }
      }
    }
  }

  clear() {
    for (const id of this.avatars.keys()) this.removePlayer(id);
  }
}
