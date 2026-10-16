import * as THREE from 'three';
import { getClip } from './avatarAnims.js';

// ---------------------------------------------------------------- 调色板
export const SKIN = {
  light1: 0xf5d6b8, light2: 0xe8c4a0,
  warm1:  0xd4a574, warm2:  0xc49a6c, warm3: 0xb07d50,
  deep1:  0x8b6338, deep2:  0x6b4423, deep3: 0x4a2f18,
};
export const HAIR_COLOR = {
  black: 0x1a1a1a, dark_brown: 0x3b2216, brown: 0x5c3a1e,
  auburn: 0x7a3b1e, ginger: 0xa0522d, blonde: 0xc9a84c,
  platinum: 0xd8cfc0, gray: 0x888888, white: 0xd0d0d0, blue_black: 0x101828,
};
export const CLOTH_COLOR = {
  white: 0xe8e8e8, cream: 0xf0e6d0, navy: 0x2a4a6b, charcoal: 0x3a3a3a,
  black: 0x1a1a1a, forest: 0x2a4a2a, burgundy: 0x6b2a2a, rust: 0x8b4513,
  slate: 0x5a6a7a, tan: 0xc4a882, brown: 0x5c3a1e, olive: 0x4a5a2a,
};

// ---------------------------------------------------------------- 身体配置
const BODY = {
  slim:    { chestW: 0.30, chestD: 0.18, hipW: 0.28, armR: 0.035, legR: 0.045 },
  average: { chestW: 0.36, chestD: 0.22, hipW: 0.34, armR: 0.045, legR: 0.055 },
  stocky:  { chestW: 0.42, chestD: 0.26, hipW: 0.40, armR: 0.055, legR: 0.065 },
  tall:    { chestW: 0.36, chestD: 0.22, hipW: 0.34, armR: 0.045, legR: 0.055 },
};
const HEAD_SHAPE = {
  square: { w: 0.18, h: 0.22, d: 0.20 },
  round:  { w: 0.20, h: 0.20, d: 0.20 },
  long:   { w: 0.17, h: 0.26, d: 0.19 },
};

// 骨骼尺寸（米）：成人标准比例基线（height=1.0 时约 1.75m）
const DIMS = {
  footH: 0.05, lowerLeg: 0.42, upperLeg: 0.44,
  spine: 0.14, chest: 0.22, neck: 0.06, head: 0.22,
  upperArm: 0.28, foreArm: 0.26, hand: 0.10,
};

// ---------------------------------------------------------------- 默认配置
export const DEFAULT_CONFIG = {
  body: 'average', height: 1.0,
  skin: 'warm3',
  headShape: 'square', jawWidth: 0.5,
  hair: 'short_back', hairColor: 'dark_brown',
  shirtStyle: 'collared', shirtColor: 'navy',
  pantsStyle: 'trousers', pantsColor: 'charcoal',
  shoeColor: 'brown',
  accessories: [],
};

// ---------------------------------------------------------------- 配件工厂
const ACC_EXCLUSIVE = { cap_forward: 'hat', cap_backward: 'hat', beanie: 'hat', fedora: 'hat', bandana: 'hat' };

function makeAcc(key, cfg) {
  const g = new THREE.Group(); g.name = 'acc_' + key;
  const m = (color, r = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: r < 0.5 ? 0.6 : 0.1 });
  switch (key) {
    case 'cap_forward': case 'cap_backward': {
      const rev = key === 'cap_backward';
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.10, 0.07, 8), m(cfg.shirtColor || 0x2a4a6b));
      crown.position.y = 0.12;
      const bill = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.09), m(cfg.shirtColor || 0x2a4a6b));
      bill.position.set(0, 0.09, rev ? 0.11 : -0.11); bill.rotation.x = rev ? 0.15 : -0.15;
      g.add(crown, bill); break;
    }
    case 'beanie': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), m(0x882222));
      b.position.y = 0.11; g.add(b); break;
    }
    case 'fedora': {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 0.10, 8), m(0x3a3a3a));
      crown.position.y = 0.13;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.008, 12), m(0x3a3a3a));
      brim.position.y = 0.08; g.add(crown, brim); break;
    }
    case 'bandana': {
      const b = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.012, 4, 12), m(0xcc2222));
      b.position.y = 0.10; b.rotation.x = Math.PI / 2; g.add(b); break;
    }
    case 'shades': {
      const lens = m(0x111111, 0.3);
      const lL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.005), lens);
      const lR = lL.clone(); lL.position.set(-0.03, 0.02, -0.10); lR.position.set(0.03, 0.02, -0.10);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.005), m(0x888888, 0.3));
      bridge.position.set(0, 0.025, -0.10); g.add(lL, lR, bridge); break;
    }
    case 'glasses_round': {
      const wire = m(0xaaaaaa, 0.3);
      const lL = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.002, 4, 8), wire);
      const lR = lL.clone(); lL.position.set(-0.03, 0.02, -0.10); lR.position.set(0.03, 0.02, -0.10);
      lL.rotation.y = Math.PI / 2; lR.rotation.y = Math.PI / 2;
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.003, 0.003), wire);
      bridge.position.set(0, 0.025, -0.10); g.add(lL, lR, bridge); break;
    }
    case 'glasses_square': {
      const frame = m(0x222222);
      const lL = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.028, 0.005), frame);
      const lR = lL.clone(); lL.position.set(-0.03, 0.02, -0.10); lR.position.set(0.03, 0.02, -0.10);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.005, 0.005), frame);
      bridge.position.set(0, 0.025, -0.10); g.add(lL, lR, bridge); break;
    }
    case 'watch_left': {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.015, 8), m(0x222222));
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.005, 8), m(0xd4af37, 0.3));
      face.position.y = 0.008; g.add(band, face); break;
    }
    case 'chain_gold': case 'chain_silver': {
      const col = key === 'chain_gold' ? 0xd4af37 : 0xbbbbbb;
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.004, 4, 16), m(col, 0.3));
      chain.rotation.x = Math.PI / 2; chain.position.set(0, -0.08, -0.02); g.add(chain); break;
    }
    case 'earring_l': case 'earring_r': case 'earrings': {
      const stud = (side) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.005, 4, 4), m(0xd4af37, 0.3)); s.position.set(side * 0.09, 0.0, -0.02); return s; };
      if (key !== 'earring_r') g.add(stud(-1));
      if (key !== 'earring_l') g.add(stud(1));
      break;
    }
    case 'cigar': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.08, 6), m(0x5c3a1e));
      c.rotation.z = 0.3; c.position.set(0.06, -0.06, -0.10); g.add(c); break;
    }
    case 'toothpick': {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.05, 4), m(0xc4a882));
      t.rotation.z = -0.2; t.position.set(0.04, -0.07, -0.10); g.add(t); break;
    }
    case 'wristband': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.018, 8), m(0xcc2222));
      g.add(b); break;
    }
  }
  return g;
}

// ---------------------------------------------------------------- 发型
function makeHair(style, color) {
  const g = new THREE.Group(); g.name = 'hair';
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  switch (style) {
    case 'none': break;
    case 'buzz': {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.19), mat);
      h.position.y = 0.12; g.add(h); break;
    }
    case 'short_back': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.19), mat);
      top.position.y = 0.13;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04), mat);
      back.position.set(0, 0.06, 0.09); g.add(top, back); break;
    }
    case 'medium': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.07, 0.21), mat);
      top.position.y = 0.14;
      const sides = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.10, 0.20), mat);
      sides.position.y = 0.07;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.05), mat);
      back.position.set(0, 0.04, 0.10); g.add(top, sides, back); break;
    }
    case 'long': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.07, 0.21), mat);
      top.position.y = 0.14;
      const sides = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.20, 0.21), mat);
      sides.position.y = 0.02;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.05), mat);
      back.position.set(0, -0.02, 0.10); g.add(top, sides, back); break;
    }
    case 'mohawk': {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.18), mat);
      strip.position.y = 0.16; g.add(strip); break;
    }
    case 'pompadour': {
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.08), mat);
      front.position.set(0, 0.16, -0.06);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.14), mat);
      top.position.y = 0.14;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.10, 0.04), mat);
      back.position.set(0, 0.06, 0.09); g.add(front, top, back); break;
    }
  }
  return g;
}

// ---------------------------------------------------------------- Avatar 类
export class Avatar {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.group = new THREE.Group();
    this.group.name = 'avatar';
    this.mixer = null;
    this.bones = {};
    this.currentAction = null;
    this.accMeshes = [];
    this.hairMesh = null;
    this._build();
  }

  // ---------- 骨骼构建 ----------
  _build() {
    const cfg = this.config;
    const bd = BODY[cfg.body] || BODY.average;
    const hs = HEAD_SHAPE[cfg.headShape] || HEAD_SHAPE.square;
    const sc = cfg.height || 1.0;

    // 材质
    const skinMat = new THREE.MeshStandardMaterial({ color: SKIN[cfg.skin] || SKIN.warm3, roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLOR[cfg.shirtColor] || CLOTH_COLOR.navy, roughness: 0.75 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLOR[cfg.pantsColor] || CLOTH_COLOR.charcoal, roughness: 0.75 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLOR[cfg.shoeColor] || CLOTH_COLOR.brown, roughness: 0.7 });

    // 创建骨骼层级
    const bones = {};
    const makeBone = (name, len = 0) => {
      const b = new THREE.Bone(); b.name = name;
      if (len) b.position.y = len;
      bones[name] = b;
      return b;
    };

    const root = makeBone('Root');
    const spine = makeBone('Spine', DIMS.footH + DIMS.lowerLeg + DIMS.upperLeg);
    const chest = makeBone('Chest', DIMS.spine);
    const neck = makeBone('Neck', DIMS.chest);
    const head = makeBone('Head', DIMS.neck);

    root.add(spine); spine.add(chest); chest.add(neck); neck.add(head);

    // 手臂
    const armOff = DIMS.chest - 0.02;
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1;
      const shoulder = makeBone(`${side}_Shoulder`, armOff);
      shoulder.position.x = sign * (bd.chestW / 2);
      shoulder.position.y = armOff;
      const upper = makeBone(`${side}_UpperArm`, 0);
      const fore = makeBone(`${side}_ForeArm`, -DIMS.upperArm);
      const hand = makeBone(`${side}_Hand`, -DIMS.foreArm);
      chest.add(shoulder); shoulder.add(upper); upper.add(fore); fore.add(hand);
    }

    // 腿
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1;
      const upper = makeBone(`${side}_UpperLeg`);
      upper.position.set(sign * (bd.hipW / 2 - 0.04), 0, 0);
      const lower = makeBone(`${side}_LowerLeg`, -DIMS.upperLeg);
      const foot = makeBone(`${side}_Foot`, -DIMS.lowerLeg);
      root.add(upper); upper.add(lower); lower.add(foot);
    }

    this.bones = bones;

    // ---------- 网格绑定骨骼 ----------
    // 为简化，使用每个身体部位独立的 SkinnedMesh（单骨影响）
    const addPart = (geo, mat, bone, offset) => {
      const mesh = new THREE.Mesh(geo, mat);
      if (offset) mesh.position.copy(offset);
      mesh.castShadow = true;
      bone.add(mesh);
      return mesh;
    };

    // 头
    addPart(new THREE.BoxGeometry(hs.w, hs.h, hs.d), skinMat, head, new THREE.Vector3(0, hs.h / 2, 0));

    // 躯干（衬衫）
    addPart(new THREE.BoxGeometry(bd.chestW, DIMS.chest, bd.chestD), shirtMat, chest, new THREE.Vector3(0, DIMS.chest / 2, 0));

    // 腰部（裤子）
    addPart(new THREE.BoxGeometry(bd.hipW, DIMS.spine, bd.chestD * 0.9), pantsMat, spine, new THREE.Vector3(0, DIMS.spine / 2, 0));

    // 衬衫领子（collared 款式）
    if (cfg.shirtStyle === 'collared') {
      addPart(new THREE.BoxGeometry(bd.chestW * 0.6, 0.025, bd.chestD * 0.4), shirtMat, neck, new THREE.Vector3(0, 0.01, -bd.chestD * 0.15));
    }

    // 手臂和手
    for (const side of ['L', 'R']) {
      const upperLen = DIMS.upperArm, foreLen = DIMS.foreArm;
      // 上臂
      addPart(
        new THREE.CylinderGeometry(bd.armR, bd.armR * 0.85, upperLen, 6),
        cfg.shirtStyle === 'tank' ? skinMat : shirtMat,
        bones[`${side}_UpperArm`],
        new THREE.Vector3(0, -upperLen / 2, 0)
      );
      // 前臂
      addPart(
        new THREE.CylinderGeometry(bd.armR * 0.85, bd.armR * 0.7, foreLen, 6),
        skinMat,
        bones[`${side}_ForeArm`],
        new THREE.Vector3(0, -foreLen / 2, 0)
      );
      // 手
      addPart(
        new THREE.BoxGeometry(0.06, 0.03, 0.10),
        skinMat,
        bones[`${side}_Hand`],
        new THREE.Vector3(0, -0.02, 0)
      );
    }

    // 腿
    for (const side of ['L', 'R']) {
      // 大腿
      addPart(
        new THREE.CylinderGeometry(bd.legR, bd.legR * 0.85, DIMS.upperLeg, 6),
        pantsMat,
        bones[`${side}_UpperLeg`],
        new THREE.Vector3(0, -DIMS.upperLeg / 2, 0)
      );
      // 小腿
      addPart(
        new THREE.CylinderGeometry(bd.legR * 0.85, bd.legR * 0.7, DIMS.lowerLeg, 6),
        pantsMat,
        bones[`${side}_LowerLeg`],
        new THREE.Vector3(0, -DIMS.lowerLeg / 2, 0)
      );
      // 脚
      addPart(
        new THREE.BoxGeometry(0.08, DIMS.footH, 0.18),
        shoeMat,
        bones[`${side}_Foot`],
        new THREE.Vector3(0, -DIMS.footH / 2, -0.03)
      );
    }

    // 缩放
    root.scale.setScalar(sc);
    this.group.add(root);

    // 发型
    this._applyHair();

    // 配件
    this._applyAccessories();

    // 动画混合器
    this.mixer = new THREE.AnimationMixer(this.group);

    // 角色足底接触柔和阴影圆盘（增强地面吸附感，消除悬浮漂浮感）
    this._buildContactShadow();
  }

  // ---------- 足底柔和接触阴影 ----------
  _buildContactShadow() {
    if (!Avatar._shadowTexture) {
      const size = 32;
      const data = new Uint8Array(size * size * 4);
      const center = (size - 1) / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;
          const dist = Math.hypot(x - center, y - center) / center;
          const alpha = dist >= 1 ? 0 : Math.round(180 * Math.pow(1 - dist, 1.8));
          data[idx] = 12;
          data[idx + 1] = 8;
          data[idx + 2] = 6;
          data[idx + 3] = alpha;
        }
      }
      const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      tex.needsUpdate = true;
      Avatar._shadowTexture = tex;
    }
    const shadowGeo = new THREE.PlaneGeometry(0.55, 0.55);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: Avatar._shadowTexture,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.003;
    this.group.add(shadow);
    this.shadowMesh = shadow;
  }

  // ---------- 位置 / 朝向 ----------
  setPosition(x, y, z) { this.group.position.set(x, y, z); }
  setRotation(yaw) { this.group.rotation.y = -yaw - Math.PI / 2; }
  _applyHair() {
    if (this.hairMesh) { this.hairMesh.parent?.remove(this.hairMesh); this.hairMesh = null; }
    const cfg = this.config;
    if (cfg.hair && cfg.hair !== 'none') {
      this.hairMesh = makeHair(cfg.hair, HAIR_COLOR[cfg.hairColor] || HAIR_COLOR.dark_brown);
      this.bones.Head.add(this.hairMesh);
    }
  }

  // ---------- 配件 ----------
  _applyAccessories() {
    // 移除旧配件
    for (const m of this.accMeshes) m.parent?.remove(m);
    this.accMeshes = [];

    const used = new Set();
    for (const key of (this.config.accessories || [])) {
      // 排他组
      const excl = ACC_EXCLUSIVE[key];
      if (excl && used.has(excl)) continue;
      if (excl) used.add(excl);

      const acc = makeAcc(key, this.config);
      // 确定挂载骨骼
      let parent = this.bones.Head;
      if (key === 'watch_left') parent = this.bones.L_Hand;
      else if (key === 'wristband') parent = this.bones.R_Hand;
      else if (key.startsWith('chain')) parent = this.bones.Chest;

      parent.add(acc);
      this.accMeshes.push(acc);
    }
  }

  // ---------- 外观重新应用 ----------
  applyConfig(config) {
    // 完整重建（配件和身体可能都变了）
    const oldParent = this.group.parent;
    this.dispose();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.group = new THREE.Group(); this.group.name = 'avatar';
    this._build();
    if (oldParent) oldParent.add(this.group);
  }

  // ---------- 动画 ----------
  play(clip, { fadeIn = 0.2, loop = null, onFinish = null } = {}) {
    if (!clip || !this.mixer) return;
    const clipName = typeof clip === 'string' ? clip : clip.name;
    const animClip = typeof clip === 'string' ? getClip(clip) : clip;
    if (!animClip) return;
    if (this.currentClipName === clipName && (loop !== false && animClip.loop !== false)) return;

    const action = this.mixer.clipAction(animClip);
    if (loop === false || (!animClip.loop && loop == null)) action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;

    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.fadeOut(fadeIn);
    }
    action.reset().fadeIn(fadeIn).play();
    this.currentAction = action;
    this.currentClipName = clipName;

    if (onFinish) {
      const handler = (e) => {
        if (e.action === action) { this.mixer.removeEventListener('finished', handler); onFinish(); }
      };
      this.mixer.addEventListener('finished', handler);
    }
  }

  // ---------- 每帧更新 ----------
  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }

  // ---------- 第一人称模式（隐藏身体，只显示手臂）----------
  setFirstPerson(enabled) {
    const hide = ['Head', 'Chest', 'Spine', 'Neck', 'L_UpperLeg', 'R_UpperLeg', 'L_LowerLeg', 'R_LowerLeg', 'L_Foot', 'R_Foot'];
    for (const name of hide) {
      const bone = this.bones[name];
      if (bone) {
        bone.traverse((c) => { if (c.isMesh) c.visible = !enabled; });
      }
    }
    // 显示手臂
    for (const side of ['L', 'R']) {
      for (const part of ['Shoulder', 'UpperArm', 'ForeArm', 'Hand']) {
        const bone = this.bones[`${side}_${part}`];
        if (bone) bone.traverse((c) => { if (c.isMesh) c.visible = true; });
      }
    }
    // 发型、配件跟随 head 可见性
    if (this.hairMesh) this.hairMesh.visible = !enabled;
    for (const acc of this.accMeshes) {
      if (acc.parent === this.bones.Head) acc.visible = !enabled;
    }
    // 第一人称隐藏足底阴影
    if (this.shadowMesh) this.shadowMesh.visible = !enabled;
  }

  // ---------- 序列化 ----------
  toJSON() { return { ...this.config }; }

  // ---------- 清理 ----------
  dispose() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    if (this.shadowMesh) {
      this.shadowMesh.geometry?.dispose();
      this.shadowMesh.material?.dispose();
      this.shadowMesh = null;
    }
    this.group.traverse((c) => {
      if (c.isMesh) { c.geometry?.dispose(); c.material?.dispose(); }
    });
    this.group.parent?.remove(this.group);
  }
}

// ---------------------------------------------------------------- 预设工厂
const store = {
  get(k, d) { try { const v = localStorage.getItem('club9.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
};

export function createAvatar(preset = 'player') {
  const presets = {
    player: store.get('avatar_p1', {
      skin: 'warm1', shirtColor: 'navy', shirtStyle: 'collared',
      hair: 'short_back', hairColor: 'dark_brown', body: 'average',
    }),
    opponent: store.get('avatar_p2', {
      skin: 'warm2', shirtColor: 'burgundy', shirtStyle: 'tee',
      hair: 'buzz', hairColor: 'black', body: 'average',
    }),
    dealer: {
      skin: 'warm3', shirtStyle: 'collared', shirtColor: 'cream',
      pantsColor: 'black', hair: 'pompadour', hairColor: 'dark_brown',
      accessories: ['glasses_round'], body: 'slim',
    },
    bartender: {
      skin: 'deep1', shirtStyle: 'collared', shirtColor: 'black',
      pantsColor: 'charcoal', hair: 'short_back', hairColor: 'black',
      accessories: ['watch_left', 'toothpick'], body: 'stocky',
    },
  };
  return new Avatar(presets[preset] || presets.player);
}
