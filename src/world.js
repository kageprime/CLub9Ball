// 渲染层：只读物理快照，绝不写回物理世界。
//  • 像素管线：低分辨率渲染目标 → 全屏后处理（有序抖动 + 调色板量化 + 暗角）→ 最近邻放大
//  • 球房：优先加载 assets/models/bar_diorama.glb（隐藏其自带球桌并按台面拟合），缺失则用程序化酒吧
//  • 木饰面：assets/textures/walnut_diff.jpg（Poly Haven 胡桃木）；环境：assets/hdri/fireplace*.hdr
//  • 其余纹理（呢绒、球面号码、地板、墙、霓虹、镖盘）全部 Canvas 程序化生成（确定性 PRNG）

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mulberry32 } from './rng.js';
import {
  BALL_R, HALF_L, HALF_W, TABLE_L, TABLE_W, CUSHION_H, RAIL_TOP, POCKETS,
  CORNER_MOUTH, SIDE_MOUTH,
} from './table.js';
import { SNAP_STRIDE } from './sim.js';
import { BOARD, BOARD_CENTER_Y, THROW_DIST } from './darts.js';
import { TRAY, rackX, quatFaceUp } from './dice.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';
import { PICKUP_SPOTS } from './coins.js';
import { Avatar, createAvatar } from './avatar.js';

export const TABLE_Y = 0.80;             // 台面离地高度
export const ROOM = { x0: -4.2, x1: 4.2, z0: -3.0, z1: 3.0, h: 3.2 };

const V3 = THREE.Vector3;

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.pixelHeight = 360;
    this.status = { bar: 'fallback', walnut: 'fallback', hdri: 'fallback' };
    this.cfg = {};
    this.time = 0;
    this.pocketAnim = new Array(16).fill(null);
    this.props = {};
    this.flashAmt = 0; this.flashColor = new THREE.Color(1, 0.2, 0.1);
    this.avatars = { player: null, opponent: null, dealer: null, bartender: null };
    // 相机平滑目标
    this.camPos = new V3(-2.4, 1.65, 0); this.camLook = new V3(0, 1.4, 0); this.camFov = 68;
    this.tgtPos = this.camPos.clone(); this.tgtLook = this.camLook.clone(); this.tgtFov = 68; this.camK = 30;
  }

  // ---------- 初始化 ----------
  async init(onProgress = () => {}) {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;     // 硬边阴影，贴合像素风
    renderer.setClearColor(0x18100c, 1);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x241812, 8, 22);
    this.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.03, 40);

    this._setupPost();
    this.resize();

    // 可选配置与素材
    this.cfg = await this._json('assets/config.json') || {};
    const steps = 4; let done = 0;
    const tick = () => onProgress(++done, steps);

    this.felt = TX.makeFelt();
    this.walnutTex = await this._loadWalnut(); tick();
    this._buildLights();
    this._buildRoom();
    this._buildTable();
    this._buildBalls();
    this._buildCue();
    this._buildAimLine();
    this._buildDarts();
    this._buildDiceProps();
    this._buildRevolver();
    this._buildChessLounge();
    this._buildLudoProps();
    this._buildBarOrder();
    this._buildCoins();
    this._buildAvatars();
    tick();
    await this._loadEnvironment(); tick();
    await this._loadBarModel(); tick();

    this.setCameraTarget(this.camPos, this.camLook, { fov: 68, snap: true });
    return this.status;
  }

  async _json(url) {
    try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (_) { return null; }
  }
  async _exists(url) {
    try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (_) { return false; }
  }

  // ---------- 像素后处理 ----------
  _setupPost() {
    this.rt = new THREE.WebGLRenderTarget(480, 270, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uLevels: { value: 12.0 }, uDither: { value: 0.9 }, uExposure: { value: 1.25 },
        uFlash: { value: 0.0 }, uFlashColor: { value: new THREE.Color(1, 0.2, 0.1) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uLevels, uDither, uExposure, uFlash; uniform vec3 uFlashColor;
        varying vec2 vUv;
        const float M[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
          c = c / (1.0 + c) * 1.18;                       // 柔和色调映射
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          vec3 s = gl_FragColor.rgb;
          s = (s - 0.5) * 1.08 + 0.5;                     // 略加对比
          ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
          float b = (M[p.y * 4 + p.x] + 0.5) / 16.0 - 0.5;
          s = floor(s * uLevels + b * uDither + 0.5) / uLevels;   // 有序抖动 + 调色板量化
          vec2 q = vUv - 0.5;
          s *= 1.0 - dot(q, q) * 0.35;                    // 柔和暗角
          s = mix(s, uFlashColor, uFlash);
          gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
  }

  setPixelHeight(h) { this.pixelHeight = Math.max(120, Math.min(540, Math.round(h))); this.resize(); }

  resize() {
    const isMobilePortrait = document.body.classList.contains('mobile-portrait');
    const deckEl = document.getElementById('mobile-deck');
    const deckH = (isMobilePortrait && deckEl && !deckEl.hidden) ? (deckEl.offsetHeight || 280) : 0;
    const vw = Math.max(1, window.innerWidth || 16);
    const vh = Math.max(1, (window.innerHeight - deckH) || 9);
    // 整数倍放大：屏幕上的每个“像素”是 N×N 个物理像素，避免非整数拉伸造成的大小不一与抖动。
    // N 取“内部高度 vh/N 最接近 pixelHeight”的整数倍率（至少 1）。
    const t = this.pixelHeight;
    const base = Math.max(1, Math.floor(vh / t));
    const N = Math.abs(vh / (base + 1) - t) < Math.abs(vh / base - t) ? base + 1 : base;
    const h = Math.max(120, Math.floor(vh / N));
    const w = Math.max(160, Math.floor(vw / N));
    this.renderer.setSize(w, h, false);
    this.rt.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.canvas.style.width = w * N + 'px';
    this.canvas.style.height = h * N + 'px';
    this.lowRes = { w, h, scale: N };
  }

  // ---------- 材质小工具 ----------
  _mat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o }); }
  _box(w, h, d, mat, x, y, z, parent = this.scene, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  }
  _cyl(rt, rb, h, mat, x, y, z, parent = this.scene, seg = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }

  async _loadWalnut() {
    const file = this.cfg?.textures?.walnut || 'assets/textures/walnut_diff.jpg';
    if (await this._exists(file)) {
      try {
        const tex = await new THREE.TextureLoader().loadAsync(file);
        tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapNearestFilter;
        this.status.walnut = 'loaded';
        return tex;
      } catch (_) { /* 落到兜底 */ }
    }
    return TX.makeWalnut();
  }

  _wood(rx = 1, ry = 1) {
    const t = this.walnutTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.8 });
  }

  // ---------- 灯光 ----------
  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x7a5a48, 0.70));
    this.scene.add(new THREE.HemisphereLight(0xffe4c4, 0x281810, 0.45));
    this.lamps = [];
    for (const x of [-0.65, 0.65]) {
      const sp = new THREE.SpotLight(0xffe2b0, 55, 5.5, 0.62, 0.55, 1.4);
      sp.position.set(x, TABLE_Y + 1.35, 0);
      sp.target.position.set(x, TABLE_Y, 0);
      sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0004;
      sp.shadow.camera.near = 0.3; sp.shadow.camera.far = 4;
      this.scene.add(sp, sp.target);
      this.lamps.push(sp);
      // 吊灯罩
      const shade = this._cyl(0.06, 0.26, 0.2, this._mat(0x1c3a2a, { roughness: 0.5 }), x, TABLE_Y + 1.5, 0, this.scene, 10);
      shade.castShadow = false;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
      bulb.position.set(x, TABLE_Y + 1.4, 0); this.scene.add(bulb);
      const cord = this._cyl(0.006, 0.006, 1.2, this._mat(0x111111), x, TABLE_Y + 2.1 + 0.2, 0, this.scene, 4);
      cord.castShadow = false;
      (this.lampMeshes ||= []).push(shade, bulb, cord);
    }
    // 壁炉火光
    this.fireLight = new THREE.PointLight(0xff7a2a, 9, 6, 1.6);
    this.fireLight.position.set(1.4, 0.7, ROOM.z1 - 0.7);
    this.scene.add(this.fireLight);
    // 休息区 / 棋牌角温暖补光
    const loungeFill = new THREE.PointLight(0xffddb4, 4.5, 7.5, 1.4);
    loungeFill.position.set(-2.8, 2.5, 0.5);
    this.scene.add(loungeFill);
    // 霓虹补光
    const neon = (c, x, y, z, i) => { const l = new THREE.PointLight(c, i, 5, 1.8); l.position.set(x, y, z); this.scene.add(l); return l; };
    neon(0xff3fb0, ROOM.x1 - 0.5, 2.3, 0.4, 5);
    neon(0x22d6e8, ROOM.x1 - 0.5, 2.3, -0.6, 4);
    neon(0xffa030, -1.5, 2.6, -2.7, 3);
  }

  // 俯视 / 高位机位会被吊灯挡住：这些网格只影响画面，光照不变
  setLampsVisible(v) { if (this._lampsVisible === v) return; this._lampsVisible = v; for (const m of this.lampMeshes || []) m.visible = v; }

  async _loadEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    let env = null;
    const names = [this.cfg?.hdri, 'assets/hdri/fireplace_1k.hdr', 'assets/hdri/fireplace.hdr'].filter(Boolean);
    for (const n of names) {
      if (!(await this._exists(n))) continue;
      try {
        const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
        const tex = await new RGBELoader().loadAsync(n);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        env = pmrem.fromEquirectangular(tex).texture; tex.dispose();
        this.status.hdri = 'loaded';
        break;
      } catch (_) { /* 继续尝试 */ }
    }
    if (!env) env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = this.status.hdri === 'loaded' ? 0.65 : 0.38;
    pmrem.dispose();
  }

  // ---------- 程序化酒吧（GLB 缺失时的兜底；也提供三个小游戏的道具） ----------
  _buildRoom() {
    const g = new THREE.Group(); this.room = g; this.scene.add(g);
    const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0, H = ROOM.h;
    const cx = (ROOM.x0 + ROOM.x1) / 2, cz = (ROOM.z0 + ROOM.z1) / 2;

    const floorTex = TX.makeFloor(); floorTex.repeat.set(W / 1.6, D / 1.6);
    this._box(W, 0.1, D, new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }), cx, -0.05, cz, g).castShadow = false;
    const ceil = this._box(W, 0.1, D, this._mat(0x2a1a10), cx, H + 0.05, cz, g, false);
    ceil.receiveShadow = false;
    const wallTex = (rx) => { const t = TX.makeWall(); t.repeat.set(rx, 1); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); };
    this._box(W, H, 0.1, wallTex(W / 1.5), cx, H / 2, ROOM.z0 - 0.05, g);
    this._box(W, H, 0.1, wallTex(W / 1.5), cx, H / 2, ROOM.z1 + 0.05, g);
    this._box(0.1, H, D, wallTex(D / 1.5), ROOM.x0 - 0.05, H / 2, cz, g);
    this._box(0.1, H, D, wallTex(D / 1.5), ROOM.x1 + 0.05, H / 2, cz, g);
    // 天花横梁
    for (let x = ROOM.x0 + 0.8; x < ROOM.x1; x += 1.6) this._box(0.18, 0.2, D, this._wood(1, 4), x, H - 0.1, cz, g);

    // 远墙霓虹招牌（九号俱乐部 / CLUB No.9）
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshBasicMaterial({ map: TX.makeNeonSign(), toneMapped: false }));
    sign.rotation.y = -Math.PI / 2; sign.position.set(ROOM.x1 - 0.02, 2.35, -0.3); g.add(sign);
    for (const sx of [-1.45, 1.45]) this._cyl(0.01, 0.01, 0.5, this._mat(0x222222), ROOM.x1 - 0.1, H - 0.25 + 0.05, -0.3 + sx, g, 4).castShadow = false;
    const open = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: TX.makeOpenSign(), toneMapped: false }));
    open.rotation.y = -Math.PI / 2; open.position.set(ROOM.x1 - 0.02, 2.1, 1.95); g.add(open);
    // 门 + EXIT
    this._box(0.06, 2.1, 1.0, this._wood(1, 2), ROOM.x1 - 0.03, 1.05, -2.2, g);
    this._box(0.04, 0.16, 0.4, new THREE.MeshBasicMaterial({ color: 0x40ff80 }), ROOM.x1 - 0.06, 2.25, -2.2, g, false);

    // 左墙：吧台 + 酒架 + 吧凳
    const barZ = ROOM.z0 + 0.82;
    this._box(6.4, 1.05, 0.65, this._wood(4, 1), 0, 0.525, barZ, g);
    this._box(6.5, 0.07, 0.75, this._mat(0x1a0f08, { roughness: 0.3 }), 0, 1.075, barZ, g);
    for (let i = 0; i < 3; i++) this._box(6.2, 0.04, 0.25, this._wood(4, 1), 0, 1.35 + i * 0.45, ROOM.z0 + 0.15, g);
    const rng = mulberry32(77);
    for (let i = 0; i < 38; i++) {
      const col = [0x2f6a2a, 0x5a2a12, 0x1c4a6a, 0x8a6a1a, 0x4a1a1a][(rng() * 5) | 0];
      const row = (rng() * 3) | 0, x = -3 + (i / 38) * 6;
      this._cyl(0.035, 0.04, 0.26, new THREE.MeshStandardMaterial({ color: col, roughness: 0.2, metalness: 0.1 }), x, 1.5 + row * 0.45, ROOM.z0 + 0.18, g, 6);
    }
    for (let i = 0; i < 5; i++) {
      const x = -2.4 + i * 1.2, z = barZ + 0.65;
      this._cyl(0.17, 0.17, 0.06, this._mat(0x6a1a14, { roughness: 0.5 }), x, 0.72, z, g, 10);
      this._cyl(0.025, 0.025, 0.7, this._mat(0x222222), x, 0.35, z, g, 6);
      this._cyl(0.15, 0.15, 0.03, this._mat(0x222222), x, 0.015, z, g, 10);
    }
    // 右墙：壁炉
    const fz = ROOM.z1;
    const brick = new THREE.MeshStandardMaterial({ map: TX.makeBrick(), roughness: 0.95 });
    this._box(2.2, 2.4, 0.6, brick, 1.4, 1.2, fz - 0.3, g);
    this._box(2.4, 0.12, 0.7, this._wood(2, 1), 1.4, 1.45, fz - 0.33, g);
    this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, toneMapped: false });
    const fire = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), this.fireMat);
    fire.rotation.y = Math.PI; fire.position.set(1.4, 0.62, fz - 0.595); g.add(fire);
    this._box(1.3, 0.05, 0.1, this._mat(0x0a0a0a), 1.4, 0.2, fz - 0.62, g);
    for (let i = 0; i < 3; i++) this._cyl(0.06, 0.06, 0.8, this._mat(0x2a1608), 1.1 + i * 0.3, 0.3 + i * 0.06, fz - 0.7, g, 6).rotation.z = Math.PI / 2;
    // 右墙：酒杯架
    for (let i = 0; i < 2; i++) {
      this._box(1.6, 0.04, 0.25, this._wood(2, 1), -1.6, 1.5 + i * 0.5, fz - 0.15, g);
      for (let k = 0; k < 10; k++) this._cyl(0.035, 0.03, 0.08, new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.15, metalness: 0.6 }), -2.25 + k * 0.14, 1.56 + i * 0.5, fz - 0.15, g, 6);
    }
    // 墙上挂画
    const frame = (x, y, z, ry, w, h, col) => {
      this._box(w + 0.08, h + 0.08, 0.04, this._wood(1, 1), x, y, z, g);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }));
      p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
      p.translateZ(0.025);
    };
    frame(-3.0, 1.9, ROOM.z1 - 0.05, Math.PI, 0.7, 0.9, 0x6a3a2a);
    frame(-1.6, 2.2, ROOM.z1 - 0.05, Math.PI, 0.5, 0.35, 0x2a4a5a);
    frame(ROOM.x0 + 0.05, 1.9, 1.5, Math.PI / 2, 0.8, 0.6, 0x4a3a1a);
    // 角落地灯
    this._cyl(0.02, 0.02, 1.5, this._mat(0x222222), ROOM.x1 - 0.4, 0.75, 2.6, g, 4);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd890 }));
    lamp.position.set(ROOM.x1 - 0.4, 1.55, 2.6); g.add(lamp);
  }

  // ---------- 球桌 ----------
  poolToWorld(x, y, z) { return new V3(x, TABLE_Y + y, z); }

  _buildTable() {
    const pool = new THREE.Group(); pool.position.set(0, TABLE_Y, 0); this.pool = pool; this.scene.add(pool);
    const wood = () => this._wood(2, 1);
    const clothMat = new THREE.MeshStandardMaterial({ map: this.felt, roughness: 0.96 });
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_L, TABLE_W), clothMat);
    felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true; pool.add(felt);
    // 呢绒延伸到库边下（略低），避免漏缝
    this._box(TABLE_L + 0.4, 0.02, TABLE_W + 0.4, this._mat(0x14502a), 0, -0.012, 0, pool, false);

    // 库边橡胶：与物理碰撞体同位置（正面精确落在 ±HALF）
    const rubber = new THREE.MeshStandardMaterial({ map: TX.makeRubber(), roughness: 0.9 });
    const th = 0.05, hh = CUSHION_H;
    const longHalf = (HALF_L - CORNER_MOUTH - SIDE_MOUTH) / 2, longCx = (HALF_L - CORNER_MOUTH + SIDE_MOUTH) / 2;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) this._box(longHalf * 2, hh, th, rubber, sx * longCx, hh / 2, sz * (HALF_W + th / 2), pool);
    for (const sx of [-1, 1]) this._box(th, hh, (HALF_W - CORNER_MOUTH) * 2, rubber, sx * (HALF_L + th / 2), hh / 2, 0, pool);

    // 木框
    const rw = 0.14;
    const railH = RAIL_TOP + 0.06;
    for (const sz of [-1, 1]) this._box(TABLE_L + rw * 2 + th * 2, railH, rw, wood(), 0, RAIL_TOP - railH / 2, sz * (HALF_W + th + rw / 2), pool);
    for (const sx of [-1, 1]) this._box(rw, railH, TABLE_W + th * 2, wood(), sx * (HALF_L + th + rw / 2), RAIL_TOP - railH / 2, 0, pool);
    // 袋口：黑洞 + 金色护圈
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.4, metalness: 0.6 });
    for (const p of POCKETS) {
      const ox = p.kind === 'corner' ? Math.sign(p.x) * 0.03 : 0, oz = Math.sign(p.z) * (p.kind === 'corner' ? 0.03 : 0.045);
      const topHole = new THREE.Mesh(new THREE.CircleGeometry(p.kind === 'corner' ? 0.065 : 0.058, 14), holeMat);
      topHole.rotation.x = -Math.PI / 2; topHole.position.set(p.x + ox, RAIL_TOP + 0.003, p.z + oz); pool.add(topHole);
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.kind === 'corner' ? 0.065 : 0.058, p.kind === 'corner' ? 0.08 : 0.07, 14), goldMat);
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x + ox, RAIL_TOP + 0.004, p.z + oz); pool.add(ring);
      const floorHole = new THREE.Mesh(new THREE.CircleGeometry(p.capture * 0.95, 14), holeMat);
      floorHole.rotation.x = -Math.PI / 2; floorHole.position.set(p.x, 0.002, p.z); pool.add(floorHole);
    }
    // 瞄准点（菱形标）
    const dia = this._mat(0xe8dcc0, { roughness: 0.4 });
    for (let i = 1; i <= 3; i++) for (const s of [-1, 1]) {
      this._box(0.014, 0.004, 0.014, dia, (i - 2) * (HALF_L / 2) * 1 + (i === 2 ? 0 : 0) + s * 0, RAIL_TOP + 0.003, s * (HALF_W + th + rw / 2), pool, false);
    }
    for (const sx of [-0.55, -0.27, 0.27, 0.55]) for (const s of [-1, 1]) this._box(0.014, 0.004, 0.014, dia, sx * HALF_L * 1.6, RAIL_TOP + 0.003, s * (HALF_W + th + rw / 2), pool, false);
    for (const sz of [-0.5, 0, 0.5]) for (const s of [-1, 1]) this._box(0.014, 0.004, 0.014, dia, s * (HALF_L + th + rw / 2), RAIL_TOP + 0.003, sz * HALF_W * 1.5, pool, false);
    // 柜体与桌腿
    this._box(TABLE_L + 0.3, 0.16, TABLE_W + 0.3, wood(), 0, -0.16, 0, pool);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._box(0.16, TABLE_Y - 0.1, 0.16, wood(), sx * (HALF_L - 0.05), -(TABLE_Y - 0.1) / 2 - 0.1, sz * (HALF_W - 0.05), pool);
  }

  // ---------- 球 ----------
  _buildBalls() {
    this.balls = [];
    const geo = new THREE.SphereGeometry(BALL_R, 32, 24);
    for (let n = 0; n < 16; n++) {
      const mat = new THREE.MeshStandardMaterial({ map: TX.makeBallTexture(n), roughness: 0.22, metalness: 0.0, envMapIntensity: 1.2 });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = false;
      this.pool.add(m); this.balls.push(m);
    }
  }

  // 只读：把物理（或回放）快照投影到网格上
  syncBalls(snap, dt = 1 / 60) {
    for (let n = 0; n < 16; n++) {
      const k = n * SNAP_STRIDE, m = this.balls[n];
      const flag = snap[k];
      if (flag >= 0) {
        m.visible = true;
        m.position.set(snap[k + 1], snap[k + 2], snap[k + 3]);
        m.quaternion.set(snap[k + 4], snap[k + 5], snap[k + 6], snap[k + 7]);
        this.pocketAnim[n] = null;
      } else {
        // 落袋：吸向最近袋口并下沉
        let a = this.pocketAnim[n];
        if (!a) {
          const px = snap[k + 1], pz = snap[k + 3];
          let best = null, bd = 0.25;
          for (const p of POCKETS) { const d = Math.hypot(p.x - px, p.z - pz); if (d < bd) { bd = d; best = p; } }
          a = this.pocketAnim[n] = { t: 0, x: px, y: snap[k + 2], z: pz, tx: best ? best.x : px, tz: best ? best.z : pz };
        }
        a.t += dt;
        const u = Math.min(1, a.t / 0.28);
        m.visible = a.t < 0.7;
        m.position.set(a.x + (a.tx - a.x) * u, a.y - 0.14 * u * u, a.z + (a.tz - a.z) * u);
      }
    }
  }

  // ---------- 球杆（第一人称） ----------
  _buildCue() {
    const g = new THREE.Group(); this.cue = g; this.pool.add(g);
    const len = 1.45;
    const woodMat = this.status.walnut === 'loaded' ? this._wood(1, 4) : new THREE.MeshStandardMaterial({ map: TX.makeCueTexture(), roughness: 0.45 });
    // 圆台沿 +z（局部），尖端在 z=0，向后延伸到 -len
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0145, len, 10, 1), woodMat);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = -len / 2; shaft.castShadow = true; g.add(shaft);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0072, 0.012, 8), new THREE.MeshStandardMaterial({ color: 0x3a70c8, roughness: 0.9 }));
    tip.rotation.x = Math.PI / 2; tip.position.z = -0.006; g.add(tip);
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.022, 8), new THREE.MeshStandardMaterial({ color: 0xf2ecda, roughness: 0.5 }));
    ferrule.rotation.x = Math.PI / 2; ferrule.position.z = -0.023; g.add(ferrule);
    g.visible = false;
    this.cueState = { visible: false, x: 0, z: 0, angle: 0, pull: 0.08, elev: 0.06, sx: 0, sy: 0, strike: null };
  }

  // 球杆姿态。pull：杆头离球面的距离（米）；sx/sy：加塞偏移（-1..1）
  setCue(s) { Object.assign(this.cueState, s); }

  cueStrike(onContact) {
    this.cueState.strike = { t: 0, from: this.cueState.pull, onContact, fired: false };
  }

  _updateCue(dt) {
    const s = this.cueState, g = this.cue;
    if (s.strike) {
      s.strike.t += dt;
      const u = Math.min(1, s.strike.t / 0.09);
      s.pullShown = s.strike.from * (1 - u * u) - 0.004 * u;
      if (u >= 1 && !s.strike.fired) { s.strike.fired = true; s.strike.onContact?.(); }
      if (s.strike.t > 0.45) { s.strike = null; s.visible = false; }
    } else s.pullShown = s.pull;
    g.visible = s.visible;
    if (!s.visible) return;
    const dx = Math.cos(s.angle), dz = Math.sin(s.angle);
    const rx = -dz, rz = dx;
    const off = 0.6 * BALL_R;
    const ox = s.sx * off, oy = s.sy * off;
    const depth = Math.sqrt(Math.max(0, BALL_R * BALL_R - ox * ox - oy * oy));
    const tipDist = depth + (s.pullShown || 0);
    g.position.set(s.x + rx * ox - dx * tipDist, BALL_R + oy + Math.sin(s.elev) * tipDist, s.z + rz * ox - dz * tipDist);
    // 局部 +z 朝向击球方向
    g.rotation.set(0, 0, 0);
    g.rotation.order = 'YXZ';
    g.rotation.y = Math.atan2(dx, dz);
    g.rotation.x = -s.elev;
  }

  // ---------- 瞄准线与粗体轨迹箭头 (Bold Ribbons & Arrows) ----------
  _distToCushion(ox, oz, dx, dz, maxD = 1.35) {
    const lx = HALF_L - BALL_R, lz = HALF_W - BALL_R;
    let dist = maxD;
    if (dx > 1e-6) dist = Math.min(dist, (lx - ox) / dx);
    if (dx < -1e-6) dist = Math.min(dist, (-lx - ox) / dx);
    if (dz > 1e-6) dist = Math.min(dist, (lz - oz) / dz);
    if (dz < -1e-6) dist = Math.min(dist, (-lz - oz) / dz);
    return Math.max(0.08, dist);
  }

  _buildArrowMesh(color, width = 0.016, withHead = true) {
    const maxVerts = 16;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(maxVerts * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    // 索引：至多 4 段四边形 (24 索引) + 1 个箭头三角形 (3 索引)
    const indices = [];
    for (let i = 0; i < 4; i++) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    indices.push(8, 9, 10);
    geo.setIndex(indices);
    geo.setDrawRange(0, 0);

    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.0028;
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.pool.add(mesh);
    return { mesh, width, withHead, geo, pos };
  }

  _updateRibbon(arrowObj, pts, customHeadLen = 0.045, customHeadW = 0.038) {
    const { mesh, width, withHead, geo, pos } = arrowObj;
    if (!pts || pts.length < 2) {
      mesh.visible = false;
      return;
    }
    const nPts = Math.min(pts.length, 5);
    const halfW = width * 0.5;

    let vertIdx = 0;
    for (let i = 0; i < nPts; i++) {
      let dx = 0, dz = 0;
      if (i < nPts - 1) {
        dx = pts[i + 1].x - pts[i].x;
        dz = pts[i + 1].z - pts[i].z;
      } else if (i > 0) {
        dx = pts[i].x - pts[i - 1].x;
        dz = pts[i].z - pts[i - 1].z;
      }
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz, nz = dx;

      let px = pts[i].x, pz = pts[i].z;
      if (withHead && i === nPts - 1) {
        px -= dx * customHeadLen * 0.7;
        pz -= dz * customHeadLen * 0.7;
      }

      pos[vertIdx * 3] = px + nx * halfW;
      pos[vertIdx * 3 + 1] = 0;
      pos[vertIdx * 3 + 2] = pz + nz * halfW;
      vertIdx++;

      pos[vertIdx * 3] = px - nx * halfW;
      pos[vertIdx * 3 + 1] = 0;
      pos[vertIdx * 3 + 2] = pz - nz * halfW;
      vertIdx++;
    }

    let indexCount = (nPts - 1) * 6;

    if (withHead && nPts >= 2) {
      const lastP = pts[nPts - 1];
      const prevP = pts[nPts - 2];
      let dx = lastP.x - prevP.x, dz = lastP.z - prevP.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz, nz = dx;

      const baseMidX = lastP.x - dx * customHeadLen;
      const baseMidZ = lastP.z - dz * customHeadLen;
      const wingW = customHeadW * 0.5;

      pos[8 * 3] = baseMidX + nx * wingW;
      pos[8 * 3 + 1] = 0;
      pos[8 * 3 + 2] = baseMidZ + nz * wingW;

      pos[9 * 3] = baseMidX - nx * wingW;
      pos[9 * 3 + 1] = 0;
      pos[9 * 3 + 2] = baseMidZ - nz * wingW;

      pos[10 * 3] = lastP.x + dx * 0.005;
      pos[10 * 3 + 1] = 0;
      pos[10 * 3 + 2] = lastP.z + dz * 0.005;

      indexCount += 3;
    }

    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, indexCount);
    mesh.visible = true;
  }

  _buildAimLine() {
    this.aim = {
      main: this._buildArrowMesh(0x54e0ee, 0.012, false),
      obj: this._buildArrowMesh(0xffcc00, 0.018, true),
      cue: this._buildArrowMesh(0x38b6ff, 0.014, true),
      ghost: null,
    };

    // 幽灵球：外发光圈 + 半透明内盘 + 中心点
    const ghostGroup = new THREE.Group();
    ghostGroup.position.y = 0.0028;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(BALL_R - 0.003, BALL_R + 0.002, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ghostGroup.add(ring);

    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_R - 0.003, 24),
      new THREE.MeshBasicMaterial({ color: 0x54e0ee, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    );
    inner.rotation.x = -Math.PI / 2;
    ghostGroup.add(inner);

    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.004, 12),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    );
    dot.rotation.x = -Math.PI / 2;
    ghostGroup.add(dot);

    ghostGroup.visible = false;
    this.pool.add(ghostGroup);
    this.aim.ghost = ghostGroup;
  }

  // trace：来自 sim.aimTrace / traceAim
  setAimLine(trace) {
    if (!trace) {
      this.aim.main.mesh.visible = false;
      this.aim.obj.mesh.visible = false;
      this.aim.cue.mesh.visible = false;
      this.aim.ghost.visible = false;
      return;
    }
    this._updateRibbon(this.aim.main, trace.points);
    const h = trace.hit;
    if (h) {
      this.aim.ghost.visible = true;
      this.aim.ghost.position.set(h.ghost.x, 0.0028, h.ghost.z);

      const ob = { x: h.ghost.x + h.objDir.x * 2 * BALL_R, z: h.ghost.z + h.objDir.z * 2 * BALL_R };
      const dist = this._distToCushion(ob.x, ob.z, h.objDir.x, h.objDir.z, 1.35);
      const objEnd = { x: ob.x + h.objDir.x * dist, z: ob.z + h.objDir.z * dist };
      this._updateRibbon(this.aim.obj, [ob, objEnd], 0.046, 0.038);

      const cl = Math.hypot(h.cueDir.x, h.cueDir.z);
      if (cl > 1e-4) {
        const cueDist = Math.max(0.2, Math.min(0.5, cl * 0.5));
        const b = trace.points[trace.points.length - 1];
        const cueEnd = { x: b.x + (h.cueDir.x / cl) * cueDist, z: b.z + (h.cueDir.z / cl) * cueDist };
        this._updateRibbon(this.aim.cue, [b, cueEnd], 0.038, 0.032);
      } else {
        this.aim.cue.mesh.visible = false;
      }
    } else {
      this.aim.ghost.visible = false;
      this.aim.obj.mesh.visible = false;
      this.aim.cue.mesh.visible = false;
    }
  }

  // ---------- 飞镖道具 ----------
  _buildDarts() {
    const p = this.cfg?.props?.darts?.pos || [ROOM.x1 - 0.01, BOARD_CENTER_Y, 1.6];
    const g = new THREE.Group(); g.position.set(...p); this.scene.add(g);
    const backing = this._cyl(BOARD.face + 0.06, BOARD.face + 0.06, 0.05, this._wood(1, 1), -0.03, 0, 0, g, 24); backing.rotation.z = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.face * 2, BOARD.face * 2), new THREE.MeshStandardMaterial({ map: TX.makeDartboard(), roughness: 0.8 }));
    face.rotation.y = -Math.PI / 2; face.position.x = -0.058; g.add(face);
    this.dartsGroup = new THREE.Group(); g.add(this.dartsGroup);
    const spot = new V3(p[0] - THROW_DIST, 0, p[2]);
    this._box(0.05, 0.01, 0.7, this._mat(0xe0d6b8), spot.x, 0.005, spot.z, this.scene, false);
    this.props.darts = { id: 'darts', pos: new V3(spot.x, 1, spot.z), radius: 1.1, boardPos: new V3(...p), spot, labelKey: 'bar.darts' };
    this.dartMeshes = [];
    // 飞行中的镖
    this.flyingDart = this._makeDart(); this.flyingDart.visible = false; this.scene.add(this.flyingDart);
  }
  _makeDart() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.8 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), metal);
    body.rotation.z = Math.PI / 2; body.position.x = -0.03; g.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.03, 6), metal); tip.rotation.z = -Math.PI / 2; tip.position.x = 0.0; g.add(tip);
    const fl = new THREE.MeshStandardMaterial({ color: 0xd8302a, roughness: 0.7, side: THREE.DoubleSide });
    for (const r of [0, Math.PI / 2]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.028), fl);
      f.position.x = -0.07; f.rotation.x = r; g.add(f);
    }
    return g;
  }
  // 在镖盘上插一枚镖。x,y 相对红心（米；x 向右，y 向上）
  addDartHit(x, y) {
    const d = this._makeDart();
    const bp = this.props.darts.boardPos;
    d.position.set(-0.058 + 0.012, y, x);
    d.rotation.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12);
    this.dartsGroup.add(d); this.dartMeshes.push(d);
    void bp;
  }
  clearDarts() { for (const d of this.dartMeshes) this.dartsGroup.remove(d); this.dartMeshes = []; }
  // 世界坐标：镖盘平面上的 (x 向右, y 向上) → world
  dartToWorld(x, y) { const b = this.props.darts.boardPos; return new V3(b.x - 0.058, b.y + y, b.z + x); }

  // ---------- 骰子桌（骰子扑克）----------
  // 圆桌 + 托盘（玩家的骰子抛在这里）+ 近端骰架（5 槽）+ 远端庄家骰排（5 颗，各扣一个骰盅）
  _buildDiceProps() {
    const p = this.cfg?.props?.dice?.pos || [2.85, 0, -0.45];
    const g = new THREE.Group(); g.position.set(p[0], 0, p[2]); this.scene.add(g);
    this._cyl(0.55, 0.55, 0.06, this._mat(0x1c4a2a, { roughness: 0.9 }), 0, 1.0, 0, g, 24);
    this._cyl(0.58, 0.58, 0.04, this._wood(2, 1), 0, 0.97, 0, g, 24);
    this._cyl(0.06, 0.08, 0.95, this._mat(0x1a1a1a, { metalness: 0.5, roughness: 0.4 }), 0, 0.48, 0, g, 8);
    this._cyl(0.3, 0.32, 0.04, this._mat(0x1a1a1a), 0, 0.02, 0, g, 12);
    // 吧椅：庄家座位及客人座位
    const stool = (sx, sz) => {
      this._cyl(0.18, 0.18, 0.05, this._mat(0x6a1a14), sx, 0.5, sz, g, 12);
      this._cyl(0.025, 0.025, 0.48, this._mat(0x1a1a1a, { metalness: 0.7 }), sx, 0.24, sz, g, 6);
      this._cyl(0.15, 0.15, 0.02, this._mat(0x1a1a1a), sx, 0.01, sz, g, 10);
    };
    stool(0.62, 0);          // 庄家椅
    stool(-0.68, -0.52);     // 客人椅 1
    stool(-0.68, 0.52);      // 客人椅 2
    this.diceRoot = g;
    this.props.dice = { id: 'dice', pos: new V3(p[0], 1.0, p[2]), radius: 1.3, labelKey: 'bar.dice' };

    // 托盘局部坐标系：+z 朝玩家（世界 -x）。原点在台面上。
    const tray = new THREE.Group(); tray.position.set(p[0], 1.03, p[2]); tray.rotation.y = -Math.PI / 2; this.scene.add(tray);
    this.diceTrayGroup = tray;
    const T = TRAY, cz = (T.z0 + T.z1) / 2, dz = T.z1 - T.z0;
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(T.hx * 2 + 0.06, dz + 0.06), new THREE.MeshStandardMaterial({ color: 0x4a1020, roughness: 0.97 }));
    felt.rotation.x = -Math.PI / 2; felt.position.set(0, 0.0015, cz); felt.receiveShadow = true; tray.add(felt);
    const rail = this._wood(1, 1);
    this._box(T.hx * 2 + 0.12, 0.05, 0.03, rail, 0, 0.025, T.z0 - 0.025, tray);
    this._box(T.hx * 2 + 0.12, 0.05, 0.03, rail, 0, 0.025, T.z1 + 0.025, tray);
    this._box(0.03, 0.05, dz + 0.08, rail, -T.hx - 0.045, 0.025, cz, tray);
    this._box(0.03, 0.05, dz + 0.08, rail, T.hx + 0.045, 0.025, cz, tray);
    // 骰架（玩家）与庄家排的底板
    const plank = (z, col) => {
      this._box(0.5, 0.012, 0.1, this._mat(col, { roughness: 0.6 }), 0, 0.0, z, tray);
      for (let i = 0; i < 5; i++) this._box(0.058, 0.002, 0.058, this._mat(0x12100c, { roughness: 1 }), rackX(i), 0.0065, z, tray, false);
    };
    plank(T.rackZ, 0x3a2412); plank(T.houseZ, 0x2a1a10);
    // 留骰标记（金色小条）
    const holdMat = new THREE.MeshBasicMaterial({ color: 0xffc23a, toneMapped: false });
    this.holdBars = [];
    for (let i = 0; i < 5; i++) { const b = this._box(0.056, 0.006, 0.01, holdMat, rackX(i), 0.011, T.rackZ + 0.05, tray, false); b.visible = false; this.holdBars.push(b); }
    // 点数牌型光圈（揭晓时在赢家那一排下面亮起）
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x5fe08a, transparent: true, opacity: 0.0, toneMapped: false });
    this.diceGlow = [];
    for (const z of [T.rackZ, T.houseZ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.11), glowMat.clone()); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.0075, z); tray.add(m); this.diceGlow.push(m);
    }

    // 骰子（圆角）
    const pipTex = (n) => {
      const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d');
      x.fillStyle = '#f4eedc'; x.fillRect(0, 0, 48, 48);
      x.fillStyle = n === 1 ? '#c93a2a' : '#1a1a1a';
      const a = 12, m = 24, b = 36;
      const P = { 1: [[m, m]], 2: [[a, a], [b, b]], 3: [[a, a], [m, m], [b, b]], 4: [[a, a], [b, a], [a, b], [b, b]], 5: [[a, a], [b, a], [m, m], [a, b], [b, b]], 6: [[a, a], [b, a], [a, m], [b, m], [a, b], [b, b]] };
      for (const [px, py] of P[n]) { x.beginPath(); x.arc(px, py, n === 1 ? 6 : 4.2, 0, Math.PI * 2); x.fill(); }
      const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const faceNums = [2, 5, 1, 6, 3, 4];           // 材质顺序 +x -x +y -y +z -z
    const mkMats = (tint) => faceNums.map((n) => { const m = new THREE.MeshStandardMaterial({ map: pipTex(n), roughness: 0.3 }); if (tint) m.color.set(tint); return m; });
    const geo = new RoundedBoxGeometry(T.half * 2, T.half * 2, T.half * 2, 2, 0.0045);
    const sets = { player: mkMats(0xffffff), house: mkMats(0xe6b9b0) };
    this.diceMeshes = { player: [], house: [] };
    for (const who of ['player', 'house']) for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(geo, sets[who]); d.castShadow = true; d.receiveShadow = true;
      d.position.set(rackX(i), T.rackY + T.half, who === 'player' ? T.rackZ : T.houseZ); d.visible = who === 'player' ? false : false;
      tray.add(d); this.diceMeshes[who].push(d);
    }
    // 庄家的骰盅
    const cupMat = new THREE.MeshStandardMaterial({ color: 0x7a3a1c, roughness: 0.55 });
    this.houseCups = [];
    for (let i = 0; i < 5; i++) {
      const cup = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.075, 12), cupMat); body.position.y = 0.0375; body.castShadow = true; cup.add(body);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0385, 0.0385, 0.012, 12), this._mat(0xc9a23a, { metalness: 0.5, roughness: 0.4 })); band.position.y = 0.012; cup.add(band);
      cup.position.set(rackX(i), 0.006, T.houseZ); tray.add(cup); this.houseCups.push(cup);
    }
    this.houseDiceState = { faces: [1, 1, 1, 1, 1], lift: 0, shake: 0, shown: false };
    this._houseYaw = [0.2, -0.3, 0.1, -0.15, 0.35];
    // 骰桌聚光灯
    const sp = new THREE.SpotLight(0xffe6c0, 22, 3.2, 0.55, 0.6, 1.5);
    sp.position.set(p[0] - 0.35, 2.0, p[2]); sp.target.position.set(p[0], 1.03, p[2]);
    sp.castShadow = true; sp.shadow.mapSize.set(512, 512); sp.shadow.bias = -0.0006; sp.shadow.camera.near = 0.5; sp.shadow.camera.far = 3.5;
    this.scene.add(sp, sp.target); this.diceLamp = sp; sp.intensity = 4;
    tray.updateMatrixWorld(true);
    this.setPlayerDice(null); this.setHouseDice(null);
  }

  // 托盘局部坐标 → 世界坐标
  diceLocal(x, y, z) { return this.diceTrayGroup.localToWorld(new V3(x, y, z)); }
  setDiceActive(on) { if (this.diceLamp) this.diceLamp.intensity = on ? 12 : 4; }

  // snap：DiceTray.snapshot()（5 项）；null → 隐藏
  setPlayerDice(snap) {
    this.diceMeshes.player.forEach((d, i) => {
      const s = snap?.[i];
      d.visible = !!s;
      if (!s) return;
      d.position.set(s.x, s.y + (s.held ? 0.012 : 0), s.z);
      d.quaternion.set(s.qx, s.qy, s.qz, s.qw);
      this.holdBars[i].visible = !!s.held;
    });
    if (!snap) this.holdBars.forEach((b) => { b.visible = false; });
  }

  // st：{faces[5], lift 0..1（骰盅揭开程度）, shake 0..1（摇动幅度）}；null → 回到初始（全部扣着、看不到骰子）
  setHouseDice(st) {
    const S = this.houseDiceState;
    if (!st) { S.faces = [1, 1, 1, 1, 1]; S.lift = 0; S.shake = 0; S.shown = false; }
    else { Object.assign(S, st); S.shown = true; }
    this._applyHouseDice();
  }
  _applyHouseDice() {
    const S = this.houseDiceState, T = TRAY, t = this.time;
    this.diceMeshes.house.forEach((d, i) => {
      d.visible = S.shown;
      d.position.set(rackX(i), T.rackY + T.half, T.houseZ);
      const q = quatFaceUp(S.faces[i], this._houseYaw[i]); d.quaternion.set(q.x, q.y, q.z, q.w);
    });
    this.houseCups.forEach((c, i) => {
      const lift = S.lift, shake = S.shake;
      c.visible = lift < 0.98;
      const ph = t * 38 + i * 1.7;
      c.position.set(rackX(i) + Math.sin(ph) * 0.007 * shake + lift * 0.0, 0.006 + lift * 0.16 + Math.abs(Math.sin(ph * 0.7)) * 0.02 * shake, T.houseZ + Math.cos(ph * 1.3) * 0.006 * shake - lift * 0.08);
      c.rotation.set(lift * 0.9 + Math.sin(ph) * 0.12 * shake, 0, Math.cos(ph) * 0.12 * shake);
    });
  }
  setDiceGlow(i, amt, color = 0x5fe08a) { const m = this.diceGlow[i]; m.material.opacity = amt; m.material.color.set(color); }

  // ---------- 左轮道具 ----------
  _buildRevolver() {
    const p = this.cfg?.props?.roulette?.pos || [-1.6, 1.115, ROOM.z0 + 0.82];
    const g = new THREE.Group(); g.position.set(...p); this.scene.add(g);
    this._cyl(0.14, 0.14, 0.012, this._mat(0x1a0f08, { roughness: 0.6 }), 0, -0.004, 0, g, 12);   // 杯垫
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a4d54, roughness: 0.35, metalness: 0.85 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.4, metalness: 0.8 });
    const woodM = this._wood(1, 1);
    const gun = new THREE.Group(); gun.position.y = 0.045; gun.rotation.y = Math.PI / 2; g.add(gun);   // 枪口朝 +x（朝房间中心外侧看时的右手方向）
    this._box(0.2, 0.04, 0.026, steel, 0.0, 0.0, 0, gun);                       // 机匣
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0105, 0.2, 10), steel); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.185, 0.012, 0); barrel.castShadow = true; gun.add(barrel);
    this._box(0.19, 0.012, 0.014, darkSteel, 0.185, 0.026, 0, gun);              // 准星 / 排风筋
    this.cylinderMesh = new THREE.Group(); this.cylinderMesh.position.set(0.0, 0.012, 0); gun.add(this.cylinderMesh);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 18), darkSteel); cyl.rotation.z = Math.PI / 2; cyl.castShadow = true; this.cylinderMesh.add(cyl);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.062, 8), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      hole.rotation.z = Math.PI / 2; hole.position.set(0, Math.sin(a) * 0.017, Math.cos(a) * 0.017); this.cylinderMesh.add(hole);
    }
    const grip = this._box(0.05, 0.1, 0.028, woodM, -0.115, -0.06, 0, gun); grip.rotation.z = 0.35;
    this._box(0.03, 0.02, 0.006, darkSteel, -0.035, -0.035, 0, gun);              // 扳机护圈
    this.hammer = this._box(0.02, 0.028, 0.008, darkSteel, -0.1, 0.03, 0, gun); this.hammer.rotation.z = 0.5;
    this.revolverGroup = g;
    this.props.roulette = { id: 'roulette', pos: new V3(p[0], p[1], p[2]), radius: 1.3, labelKey: 'bar.roulette' };
    this.cylAngle = 0; this.cylTarget = 0;
  }
  setRevolverCylinder(steps, instant = false) { this.cylTarget = (steps * Math.PI) / 3; if (instant) this.cylAngle = this.cylTarget; }
  hammerFall() { this.hammer.rotation.z = -0.1; setTimeout(() => { if (this.hammer) this.hammer.rotation.z = 0.5; }, 220); }
  flash(color = 0xff3a1a, amt = 0.85) { this.flashColor.set(color); this.postMat.uniforms.uFlashColor.value.copy(this.flashColor); this.flashAmt = amt; }

  // ---------- 国际象棋展位 ----------
  _buildChessLounge() {
    const cp = this.cfg?.props?.chess?.pos || [-2.8, 0, 1.8];
    const g = new THREE.Group(); g.position.set(cp[0], 0, cp[2]); this.scene.add(g);

    // 茶几台面 (高 0.72m)
    this._cyl(0.48, 0.48, 0.04, this._wood(2, 1), 0, 0.70, 0, g, 20);
    this._cyl(0.045, 0.06, 0.68, this._mat(0x1a1a1a, { metalness: 0.7, roughness: 0.3 }), 0, 0.34, 0, g, 8);
    this._cyl(0.28, 0.30, 0.03, this._mat(0x1a1a1a), 0, 0.015, 0, g, 12);

    // 棋盘 (8x8 棋格，宽 0.36m)
    const boardGroup = new THREE.Group(); boardGroup.position.set(0, 0.722, 0); g.add(boardGroup);
    const sq = 0.36 / 8;
    const lightTile = new THREE.MeshStandardMaterial({ color: 0xf0dfc2, roughness: 0.4 });
    const darkTile = new THREE.MeshStandardMaterial({ color: 0x3a2012, roughness: 0.5 });
    const tileGeo = new THREE.PlaneGeometry(sq * 0.96, sq * 0.96);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isDark = (r + c) % 2 === 1;
        const tile = new THREE.Mesh(tileGeo, isDark ? darkTile : lightTile);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set((c - 3.5) * sq, 0, (r - 3.5) * sq);
        tile.receiveShadow = true;
        boardGroup.add(tile);
      }
    }

    // 棋子 (微缩低模)
    const whitePieceMat = new THREE.MeshStandardMaterial({ color: 0xf5ede0, roughness: 0.35 });
    const blackPieceMat = new THREE.MeshStandardMaterial({ color: 0x221a16, roughness: 0.4 });

    const addPawn = (mat, x, z) => {
      this._cyl(0.011, 0.013, 0.024, mat, x, 0.722 + 0.012, z, g, 8);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), mat);
      head.position.set(x, 0.722 + 0.028, z); g.add(head);
    };
    const addMajor = (mat, x, z, h = 0.038) => {
      this._cyl(0.013, 0.016, h, mat, x, 0.722 + h / 2, z, g, 8);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.008, 8), mat);
      cap.position.set(x, 0.722 + h + 0.004, z); g.add(cap);
    };

    // 白方棋子
    for (let c = 0; c < 8; c++) addPawn(whitePieceMat, (c - 3.5) * sq, -1.5 * sq);
    for (let c = 0; c < 8; c++) addMajor(whitePieceMat, (c - 3.5) * sq, -2.5 * sq, c === 3 || c === 4 ? 0.046 : 0.038);

    // 黑方棋子
    for (let c = 0; c < 8; c++) addPawn(blackPieceMat, (c - 3.5) * sq, 1.5 * sq);
    for (let c = 0; c < 8; c++) addMajor(blackPieceMat, (c - 3.5) * sq, 2.5 * sq, c === 3 || c === 4 ? 0.046 : 0.038);

    // 两张俱乐部单人扶手皮椅
    const leather = this._mat(0x5a1810, { roughness: 0.6 });
    const woodLeg = this._wood(1, 1);
    const chair = (cz, ry) => {
      const cg = new THREE.Group(); cg.position.set(0, 0, cz); cg.rotation.y = ry; g.add(cg);
      this._box(0.5, 0.12, 0.48, leather, 0, 0.44, 0, cg);
      this._box(0.5, 0.45, 0.1, leather, 0, 0.68, -0.2, cg);
      this._box(0.09, 0.22, 0.46, leather, -0.28, 0.52, 0, cg);
      this._box(0.09, 0.22, 0.46, leather, 0.28, 0.52, 0, cg);
      for (const sx of [-0.22, 0.22]) for (const sz of [-0.18, 0.18]) {
        this._box(0.04, 0.38, 0.04, woodLeg, sx, 0.19, sz, cg);
      }
    };
    chair(-0.65, 0);
    chair(0.65, Math.PI);

    // 棋桌上方暖光吊灯
    const lampG = new THREE.Group(); lampG.position.set(cp[0], 2.4, cp[2]); this.scene.add(lampG);
    this._cyl(0.16, 0.08, 0.12, this._mat(0x222222, { metalness: 0.7 }), 0, 0, 0, lampG, 12);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe4aa }));
    bulb.position.y = -0.04; lampG.add(bulb);
    const light = new THREE.PointLight(0xffddaa, 3, 3.8);
    light.position.set(cp[0], 2.2, cp[2]); this.scene.add(light);

    this.props.chess = { id: 'chess', pos: new V3(cp[0], 0.8, cp[2]), radius: 1.35, labelKey: 'bar.chess' };
  }

  // ---------- 飞行棋展桌（Ludo Club）----------
  _buildLudoProps() {
    const lp = this.cfg?.props?.ludo?.pos || [-2.85, 0, -0.45];
    const g = new THREE.Group(); g.position.set(lp[0], 0, lp[2]); this.scene.add(g);
    this.ludoTableGroup = g;

    // 棋桌圆台面 (高 1.0m) 墨绿高级呢绒与胡桃木包边
    this._cyl(0.55, 0.55, 0.06, this._mat(0x154e2d, { roughness: 0.85 }), 0, 1.0, 0, g, 24);
    this._cyl(0.58, 0.58, 0.04, this._wood(2, 1), 0, 0.97, 0, g, 24);
    this._cyl(0.06, 0.08, 0.95, this._mat(0x1a1a1a, { metalness: 0.5, roughness: 0.4 }), 0, 0.48, 0, g, 8);
    this._cyl(0.3, 0.32, 0.04, this._mat(0x1a1a1a), 0, 0.02, 0, g, 12);

    // 3D 飞行棋棋盘 (正方形 0.52m x 0.52m)
    const boardG = new THREE.Group(); boardG.position.set(0, 1.032, 0); g.add(boardG);
    this.ludoBoardGroup = boardG;

    // 生成奢华程序化飞行棋盘纹理（高对比亮色棋盘）
    const makeLudoBoardTexture = () => {
      const c = document.createElement('canvas'); c.width = c.height = 1024;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#f3ecdd'; ctx.fillRect(0, 0, 1024, 1024);
      const cs = 1024 / 15;

      // 绘制所有公共白格底色与微细边线
      for (let gy = 0; gy < 15; gy++) {
        for (let gx = 0; gx < 15; gx++) {
          const inYard = (gx < 6 && gy < 6) || (gx > 8 && gy < 6) || (gx > 8 && gy > 8) || (gx < 6 && gy > 8);
          const inCenter = (gx >= 6 && gx <= 8 && gy >= 6 && gy <= 8);
          if (!inYard && !inCenter) {
            ctx.fillStyle = '#fbf7ee';
            ctx.fillRect(gx * cs + 1.5, gy * cs + 1.5, cs - 3, cs - 3);
          }
        }
      }

      const qDefs = [
        { c: '#ef4444', dark: '#991b1b', x0: 0, y0: 0, cx: 3 * cs, cy: 3 * cs, sx: [[1.8, 1.8], [4.2, 1.8], [1.8, 4.2], [4.2, 4.2]] },
        { c: '#10b981', dark: '#065f46', x0: 9 * cs, y0: 0, cx: 12 * cs, cy: 3 * cs, sx: [[10.8, 1.8], [13.2, 1.8], [10.8, 4.2], [13.2, 4.2]] },
        { c: '#f59e0b', dark: '#92400e', x0: 9 * cs, y0: 9 * cs, cx: 12 * cs, cy: 12 * cs, sx: [[10.8, 10.8], [13.2, 10.8], [10.8, 13.2], [13.2, 13.2]] },
        { c: '#3b82f6', dark: '#1e40af', x0: 0, y0: 9 * cs, cx: 3 * cs, cy: 12 * cs, sx: [[1.8, 10.8], [4.2, 10.8], [1.8, 13.2], [4.2, 13.2]] },
      ];

      // 四色家园大基地
      for (const q of qDefs) {
        ctx.fillStyle = q.c;
        ctx.fillRect(q.x0, q.y0, 6 * cs, 6 * cs);
        ctx.fillStyle = '#f7f1e4';
        ctx.beginPath(); ctx.arc(q.cx, q.cy, 2.2 * cs, 0, Math.PI * 2); ctx.fill();
        for (const [px, py] of q.sx) {
          ctx.beginPath(); ctx.arc(px * cs, py * cs, 0.62 * cs, 0, Math.PI * 2);
          ctx.fillStyle = '#fbbf24'; ctx.fill();
          ctx.beginPath(); ctx.arc(px * cs, py * cs, 0.48 * cs, 0, Math.PI * 2);
          ctx.fillStyle = q.dark; ctx.fill();
        }
      }

      // 公共网格线
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2.5;
      for (let i = 0; i <= 15; i++) {
        if (i >= 6 && i <= 9) {
          ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, 1024); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(1024, i * cs); ctx.stroke();
        }
      }

      // 家园冲刺道 (Home stretches)
      const fillTiles = (tiles, col) => {
        ctx.fillStyle = col;
        for (const [gx, gy] of tiles) {
          ctx.fillRect(gx * cs + 1.5, gy * cs + 1.5, cs - 3, cs - 3);
        }
      };
      fillTiles([[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]], '#ef4444');
      fillTiles([[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], '#10b981');
      fillTiles([[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], '#f59e0b');
      fillTiles([[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], '#3b82f6');

      // 起跑起点格与方向箭头
      const starts = [
        { gx: 6, gy: 1, c: '#ef4444', dir: [0, 1] },
        { gx: 13, gy: 6, c: '#10b981', dir: [-1, 0] },
        { gx: 8, gy: 13, c: '#f59e0b', dir: [0, -1] },
        { gx: 1, gy: 8, c: '#3b82f6', dir: [1, 0] },
      ];
      for (const s of starts) {
        ctx.fillStyle = s.c;
        ctx.fillRect(s.gx * cs + 1.5, s.gy * cs + 1.5, cs - 3, cs - 3);
        ctx.fillStyle = '#ffffff';
        const cx = (s.gx + 0.5) * cs, cy = (s.gy + 0.5) * cs;
        ctx.beginPath();
        if (s.dir[0] === 1) { ctx.moveTo(cx - 10, cy - 10); ctx.lineTo(cx + 12, cy); ctx.lineTo(cx - 10, cy + 10); }
        else if (s.dir[0] === -1) { ctx.moveTo(cx + 10, cy - 10); ctx.lineTo(cx - 12, cy); ctx.lineTo(cx + 10, cy + 10); }
        else if (s.dir[1] === 1) { ctx.moveTo(cx - 10, cy - 10); ctx.lineTo(cx, cy + 12); ctx.lineTo(cx + 10, cy - 10); }
        else { ctx.moveTo(cx - 10, cy + 10); ctx.lineTo(cx, cy - 12); ctx.lineTo(cx + 10, cy + 10); }
        ctx.closePath(); ctx.fill();
      }

      // 安全金星格 (Safe stars: 0, 8, 13, 21, 26, 34, 39, 47)
      const starTiles = [[8, 5], [9, 8], [6, 9], [5, 6]];
      for (const [gx, gy] of starTiles) {
        ctx.fillStyle = '#fef3c7'; ctx.fillRect(gx * cs + 1.5, gy * cs + 1.5, cs - 3, cs - 3);
        ctx.fillStyle = '#d97706';
        const cx = (gx + 0.5) * cs, cy = (gy + 0.5) * cs, rOut = cs * 0.32, rIn = cs * 0.14;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a1 = (i * 72 - 90) * Math.PI / 180, a2 = (i * 72 + 36 - 90) * Math.PI / 180;
          if (i === 0) ctx.moveTo(cx + Math.cos(a1) * rOut, cy + Math.sin(a1) * rOut);
          else ctx.lineTo(cx + Math.cos(a1) * rOut, cy + Math.sin(a1) * rOut);
          ctx.lineTo(cx + Math.cos(a2) * rIn, cy + Math.sin(a2) * rIn);
        }
        ctx.closePath(); ctx.fill();
      }

      // 中心四色三角汇聚区
      const mid = 512;
      const tris = [
        { c: '#ef4444', p1: [6 * cs, 6 * cs], p2: [9 * cs, 6 * cs] },
        { c: '#10b981', p1: [9 * cs, 6 * cs], p2: [9 * cs, 9 * cs] },
        { c: '#f59e0b', p1: [9 * cs, 9 * cs], p2: [6 * cs, 9 * cs] },
        { c: '#3b82f6', p1: [6 * cs, 9 * cs], p2: [6 * cs, 6 * cs] },
      ];
      for (const tr of tris) {
        ctx.fillStyle = tr.c;
        ctx.beginPath(); ctx.moveTo(tr.p1[0], tr.p1[1]); ctx.lineTo(tr.p2[0], tr.p2[1]); ctx.lineTo(mid, mid); ctx.closePath(); ctx.fill();
      }

      // 中心骰盅托盘底
      ctx.beginPath(); ctx.arc(mid, mid, 1.15 * cs, 0, Math.PI * 2);
      ctx.fillStyle = '#1e120a'; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#f59e0b'; ctx.stroke();

      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      return t;
    };

    const boardTex = makeLudoBoardTexture();
    const borderMat = this._wood(1, 1);
    this._box(0.54, 0.016, 0.54, borderMat, 0, 0, 0, boardG);
    const boardMat = new THREE.MeshStandardMaterial({
      map: boardTex,
      roughness: 0.18,
      metalness: 0.04,
      emissive: 0xffffff,
      emissiveMap: boardTex,
      emissiveIntensity: 0.30,
    });
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), boardMat);
    boardMesh.rotation.x = -Math.PI / 2; boardMesh.position.y = 0.0085; boardMesh.receiveShadow = false; boardG.add(boardMesh);

    // 中心微型掷骰木托盘
    this._cyl(0.062, 0.062, 0.008, borderMat, 0, 0.012, 0, boardG, 24);
    this._cyl(0.056, 0.056, 0.003, this._mat(0x1a0f08, { roughness: 0.95 }), 0, 0.015, 0, boardG, 24);

    // 3D 飞行棋中心骰子（自发光防暗色）
    const pipTex = (n) => {
      const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 48, 48);
      x.fillStyle = n === 1 ? '#ef4444' : '#1e1e1e';
      const a = 12, m = 24, b = 36;
      const P = { 1: [[m, m]], 2: [[a, a], [b, b]], 3: [[a, a], [m, m], [b, b]], 4: [[a, a], [b, a], [a, b], [b, b]], 5: [[a, a], [b, a], [m, m], [a, b], [b, b]], 6: [[a, a], [b, a], [a, m], [b, m], [a, b], [b, b]] };
      for (const [px, py] of P[n]) { x.beginPath(); x.arc(px, py, n === 1 ? 6.5 : 4.4, 0, Math.PI * 2); x.fill(); }
      const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const faceNums = [2, 5, 1, 6, 3, 4]; // +x -x +y -y +z -z
    const dieMats = faceNums.map(n => {
      const tex = pipTex(n);
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.2,
        metalness: 0.05,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.26,
      });
    });
    this.ludoDie = new THREE.Mesh(new RoundedBoxGeometry(0.034, 0.034, 0.034, 2, 0.004), dieMats);
    this.ludoDie.position.set(0, 0.032, 0); this.ludoDie.castShadow = true; boardG.add(this.ludoDie);

    // 16 枚精致 3D 飞行棋棋子 (4 玩家 x 4 棋子)
    const qCols = [0xef4444, 0x10b981, 0xf59e0b, 0x3b82f6];
    this.ludoTokens = { 0: [], 1: [], 2: [], 3: [] };
    const pawnGeoBase = new THREE.CylinderGeometry(0.012, 0.014, 0.006, 16);
    const pawnGeoBody = new THREE.CylinderGeometry(0.0065, 0.011, 0.018, 16);
    const pawnGeoHead = new THREE.SphereGeometry(0.008, 16, 12);
    const haloGeo = new THREE.RingGeometry(0.013, 0.019, 20);

    for (let p = 0; p < 4; p++) {
      const pMat = new THREE.MeshStandardMaterial({
        color: qCols[p],
        roughness: 0.22,
        metalness: 0.2,
        emissive: qCols[p],
        emissiveIntensity: 0.22,
      });
      const haloMat = new THREE.MeshBasicMaterial({ color: 0xfff066, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
      for (let i = 0; i < 4; i++) {
        const tg = new THREE.Group();
        const base = new THREE.Mesh(pawnGeoBase, pMat); base.position.y = 0.003; base.castShadow = true; base.receiveShadow = false; tg.add(base);
        const body = new THREE.Mesh(pawnGeoBody, pMat); body.position.y = 0.013; body.castShadow = true; tg.add(body);
        const head = new THREE.Mesh(pawnGeoHead, pMat); head.position.y = 0.024; head.castShadow = true; tg.add(head);
        const halo = new THREE.Mesh(haloGeo, haloMat.clone()); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.001; halo.visible = false; tg.add(halo);
        tg.userData = { player: p, token: i, halo };
        tg.position.set(0, 0.0085, 0);
        boardG.add(tg);
        this.ludoTokens[p].push(tg);
      }
    }

    // 四色吧椅围绕飞行棋桌 (红绿黄蓝)
    const stool = (sx, sz, col = 0x18446a) => {
      this._cyl(0.18, 0.18, 0.05, this._mat(col, { roughness: 0.6 }), sx, 0.5, sz, g, 14);
      this._cyl(0.025, 0.025, 0.48, this._mat(0x1a1a1a, { metalness: 0.7 }), sx, 0.24, sz, g, 6);
      this._cyl(0.15, 0.15, 0.02, this._mat(0x1a1a1a), sx, 0.01, sz, g, 10);
    };
    stool(0, 0.65, 0x991b1b);    // 红色玩家椅 (近端 +z)
    stool(0, -0.65, 0x065f46);   // 绿色对手椅 (远端 -z)
    stool(0.65, 0, 0x92400e);    // 黄色对手椅 (+x)
    stool(-0.65, 0, 0x1e40af);   // 蓝色对手椅 (-x)

    // 棋桌正上方垂直投射高亮暖白聚光灯与环境暖光
    const lampG = new THREE.Group(); lampG.position.set(lp[0], 2.3, lp[2]); this.scene.add(lampG);
    this._cyl(0.16, 0.08, 0.12, this._mat(0x222222, { metalness: 0.7 }), 0, 0, 0, lampG, 12);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff4dc }));
    bulb.position.y = -0.04; lampG.add(bulb);
    const ludoBulbLight = new THREE.PointLight(0xfff4dc, 8, 4.0, 1.2);
    ludoBulbLight.position.set(lp[0], 2.2, lp[2]); this.scene.add(ludoBulbLight);
    this.ludoBulbLight = ludoBulbLight;

    const sp = new THREE.SpotLight(0xfff6e6, 25, 4.2, 0.85, 0.35, 1.2);
    sp.position.set(lp[0], 2.2, lp[2]); sp.target.position.set(lp[0], 1.03, lp[2]);
    sp.castShadow = false;
    this.scene.add(sp, sp.target);
    this.ludoLamp = sp;

    g.updateMatrixWorld(true);
    boardG.updateMatrixWorld(true);

    this.props.ludo = { id: 'ludo', pos: new V3(lp[0], 1.0, lp[2]), radius: 1.3, labelKey: 'bar.ludo' };
  }

  // ---------- 飞行棋 3D 坐标转换与交互 API ----------
  ludoLocal(x, y, z) {
    if (this.ludoBoardGroup) return this.ludoBoardGroup.localToWorld(new V3(x, y, z));
    const lp = this.cfg?.props?.ludo?.pos || [-2.85, 1.032, -0.45];
    return new V3(lp[0] + x, lp[1] + y, lp[2] + z);
  }
  setLudoActive(on) {
    if (this.ludoLamp) this.ludoLamp.intensity = on ? 38 : 25;
    if (this.ludoBulbLight) this.ludoBulbLight.intensity = on ? 12 : 8;
  }
  ludoGridToLocal(gx, gz, y = 0.0085) {
    const s = 0.52 / 15;
    return new THREE.Vector3((gx - 7) * s, y, (gz - 7) * s);
  }
  setLudoTokenPos(pIdx, tIdx, x, y, z) {
    const tok = this.ludoTokens[pIdx]?.[tIdx];
    if (tok) tok.position.set(x, y, z);
  }
  setLudoTokenVisible(pIdx, tIdx, visible) {
    const tok = this.ludoTokens[pIdx]?.[tIdx];
    if (tok) tok.visible = visible;
  }
  setLudoTokenGlow(pIdx, tIdx, active) {
    const tok = this.ludoTokens[pIdx]?.[tIdx];
    if (tok?.userData?.halo) tok.userData.halo.visible = active;
  }
  setLudoDie(face, x, y, z, qx, qy, qz, qw) {
    if (!this.ludoDie) return;
    this.ludoDie.position.set(x, y, z);
    this.ludoDie.quaternion.set(qx, qy, qz, qw);
  }
  raycastLudoToken(screenX, screenY) {
    if (!this.camera || !this.ludoTokens) return null;
    const rct = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(((screenX - rct.left) / rct.width) * 2 - 1, -((screenY - rct.top) / rct.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.camera);
    const meshes = [];
    for (const p of [0, 1, 2, 3]) {
      for (const tok of this.ludoTokens[p] || []) {
        if (tok.visible) meshes.push(...tok.children);
      }
    }
    const hits = ray.intersectObjects(meshes, true);
    if (!hits.length) return null;
    let curr = hits[0].object;
    while (curr && (!curr.userData || curr.userData.player === undefined)) curr = curr.parent;
    return curr?.userData || null;
  }

  // ---------- 吧台点酒交互 ----------
  _buildBarOrder() {
    const p = [-0.6, 1.11, ROOM.z0 + 0.82];
    const g = new THREE.Group(); g.position.set(...p); this.scene.add(g);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
    this._cyl(0.038, 0.035, 0.12, glassMat, 0, 0.06, 0, g, 10);
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.038, 0.02, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    foam.position.y = 0.12; g.add(foam);
    this._cyl(0.05, 0.05, 0.005, this._mat(0x1a0f08), 0, 0.002, 0, g, 10);

    this.props.drink = { id: 'drink', pos: new V3(p[0], p[1], p[2]), radius: 1.1, labelKey: 'bar.drink' };
  }

  // ---------- 3D 金币拾取群 ----------
  _buildCoins() {
    this.coinMeshes = [];
    const geo = new THREE.CylinderGeometry(0.075, 0.075, 0.016, 16);
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffbb00,
      metalness: 0.88,
      roughness: 0.22,
      emissive: 0x442800,
    });

    for (let i = 0; i < PICKUP_SPOTS.length; i++) {
      const s = PICKUP_SPOTS[i];
      const m = new THREE.Mesh(geo, goldMat);
      m.position.set(s.x, s.y, s.z);
      m.castShadow = true;
      this.scene.add(m);
      this.coinMeshes.push(m);
    }
  }

  syncCoins(pickupList) {
    if (!pickupList || !this.coinMeshes) return;
    const t = this.time;
    for (let i = 0; i < pickupList.length && i < this.coinMeshes.length; i++) {
      const p = pickupList[i], m = this.coinMeshes[i];
      m.visible = !!p.active;
      if (p.active) {
        m.position.set(p.x, p.y + Math.sin(t * 3.2 + p.bobPhase) * 0.04, p.z);
        m.rotation.y = t * 2.6;
        m.rotation.x = Math.PI / 8;
      }
    }
  }

  // ---------- 3D 人形角色 ----------
  _buildAvatars() {
    this.avatars = {
      player: createAvatar('player'),
      opponent: createAvatar('opponent'),
      dealer: createAvatar('dealer'),
      bartender: createAvatar('bartender'),
    };
    for (const [name, av] of Object.entries(this.avatars)) {
      if (av) {
        av.group.name = 'avatar_' + name;
        this.scene.add(av.group);
      }
    }

    // 默认 NPC 站位与待机动画
    if (this.avatars.dealer && this.diceTrayGroup) {
      this.avatars.dealer.setPosition(3.48, 0, -0.45);
      this.avatars.dealer.setRotation(Math.PI);
      this.avatars.dealer.play('sit_idle');
    }
    if (this.avatars.bartender) {
      this.avatars.bartender.setPosition(-0.5, 0, ROOM.z0 + 0.3);
      this.avatars.bartender.setRotation(Math.PI / 2);
      this.avatars.bartender.play('bartender_wipe');
    }
    if (this.avatars.opponent) {
      this.avatars.opponent.setPosition(HALF_L + 0.65, 0, HALF_W + 0.55);
      this.avatars.opponent.setRotation(Math.PI * 0.75);
      this.avatars.opponent.play('pool_watch');
    }
    if (this.avatars.player) {
      this.avatars.player.setPosition(-2.3, 0, 0);
      this.avatars.player.setRotation(0);
      this.avatars.player.play('idle');
      this.avatars.player.group.visible = false;
    }
  }

  updateAvatars(dt) {
    for (const av of Object.values(this.avatars)) {
      if (av) av.update(dt);
    }
  }

  setPlayerAvatar(state) {
    if (!state) return;
    const target = state.target || 'player';
    const av = this.avatars[target];
    if (!av) return;
    if (state.visible != null) av.group.visible = state.visible;
    if (state.x != null && state.z != null) av.setPosition(state.x, state.y ?? 0, state.z);
    if (state.yaw != null) av.setRotation(state.yaw);
    if (state.action) av.play(state.action);
  }

  setAvatarFirstPerson(name = 'player', enabled = true) {
    this.avatars[name]?.setFirstPerson(enabled);
  }

  // ---------- GLB 球房（可选） ----------
  async _loadBarModel() {
    const url = this.cfg?.bar?.url || 'assets/models/bar_diorama.glb';
    if (!(await this._exists(url))) return;
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;
      const hide = this.cfg?.bar?.hide;
      const hideRe = new RegExp(this.cfg?.bar?.hideRegex || '(pool|billiard|snooker)', 'i');
      const tableBox = new THREE.Box3(); let hasTable = false;
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const nm = `${o.name} ${o.parent?.name || ''} ${o.material?.name || ''}`;
        if ((Array.isArray(hide) && hide.includes(o.name)) || hideRe.test(nm)) {
          tableBox.expandByObject(o); hasTable = true; o.visible = false;
        }
        if (o.material) { o.material.envMapIntensity = 0.6; if (o.material.map) { o.material.map.magFilter = THREE.NearestFilter; o.material.map.minFilter = THREE.NearestFilter; } }
      });
      // 按台面拟合：把模型自带球桌的包围盒中心/长度/台面高度对齐到我们的球桌
      const wrap = new THREE.Group(); wrap.add(root); this.scene.add(wrap);
      const cfgB = this.cfg?.bar || {};
      if (hasTable && cfgB.autoFit !== false) {
        const size = tableBox.getSize(new V3()), c = tableBox.getCenter(new V3());
        const longIsZ = size.z > size.x;
        const long = Math.max(size.x, size.z);
        const s = (cfgB.scale ?? ((TABLE_L + 0.4) / long));
        wrap.scale.setScalar(s);
        if (longIsZ) wrap.rotation.y = Math.PI / 2;
        wrap.updateMatrixWorld(true);
        const tb = new THREE.Box3(); root.traverse((o) => { if (o.isMesh && !o.visible) tb.expandByObject(o); });
        const cc = tb.getCenter(new V3());
        wrap.position.set(-cc.x, TABLE_Y + RAIL_TOP - tb.max.y, -cc.z);
        void c;
      } else {
        wrap.scale.setScalar(cfgB.scale ?? 1);
        wrap.rotation.y = cfgB.rotY ?? 0;
        if (cfgB.offset) wrap.position.set(...cfgB.offset);
      }
      this.room.visible = false;      // 隐藏程序化兜底房间（霓虹/壁炉灯光保留）
      this.barModel = wrap;
      this.status.bar = hasTable ? 'loaded' : 'loaded (no table node found: set assets/config.json bar.hide)';
    } catch (e) {
      console.warn('球房模型加载失败，使用程序化兜底：', e);
    }
  }

  // ---------- 相机 ----------
  setCameraTarget(pos, look, { fov = null, snap = false, k = null } = {}) {
    this.tgtPos.copy(pos); this.tgtLook.copy(look);
    if (fov != null) this.tgtFov = fov;
    if (k != null) this.camK = k;
    if (snap) { this.camPos.copy(pos); this.camLook.copy(look); this.camFov = this.tgtFov; }
  }

  // ---------- 帧更新 ----------
  update(dt) {
    this.time += dt;
    this._updateCue(dt);
    this.updateAvatars(dt);
    // 相机阻尼
    const a = 1 - Math.exp(-dt * this.camK);
    this.camPos.lerp(this.tgtPos, a); this.camLook.lerp(this.tgtLook, a);
    this.camFov += (this.tgtFov - this.camFov) * a;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) { this.camera.fov = this.camFov; this.camera.updateProjectionMatrix(); }
    // 壁炉闪烁
    const f = 0.85 + 0.25 * Math.sin(this.time * 9.1) * Math.sin(this.time * 5.3 + 1) + 0.1 * Math.sin(this.time * 23);
    this.fireLight.intensity = 9 * f;
    if (this.fireMat) this.fireMat.color.setHSL(0.07 + 0.015 * Math.sin(this.time * 7), 1, 0.45 + 0.08 * f);
    if (this.houseDiceState?.shake > 0) this._applyHouseDice();
    // 轮盘转轮平滑转动
    if (this.cylinderMesh) { this.cylAngle += (this.cylTarget - this.cylAngle) * (1 - Math.exp(-dt * 14)); this.cylinderMesh.rotation.x = this.cylAngle; }
    if (this.flashAmt > 0) this.flashAmt = Math.max(0, this.flashAmt - dt * 2.2);
    this.postMat.uniforms.uFlash.value = this.flashAmt;
  }

  render() {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }

  // 屏幕 → 台面（用于自由球摆放）。ndc: {x,y} ∈ [-1,1]
  pickTable(ndc) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const plane = new THREE.Plane(new V3(0, 1, 0), -(TABLE_Y + BALL_R));
    const hit = new V3();
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
  }
}
