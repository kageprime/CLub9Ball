// 角色自定义界面：Sims 风格外观编辑器，带 3D 实时预览。
// 独立覆盖层，通过 openCustomizer() 打开，保存到 localStorage。

import * as THREE from 'three';
import { Avatar, DEFAULT_CONFIG, SKIN, HAIR_COLOR, CLOTH_COLOR } from './avatar.js';
import { mulberry32 } from './rng.js';
import { t } from './i18n.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem('club9.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('club9.' + k, JSON.stringify(v)); } catch (_) { /* 隐私模式 */ } },
};

const HAIR_STYLES = ['none', 'buzz', 'short_back', 'medium', 'long', 'mohawk', 'pompadour'];
const BODY_TYPES = ['slim', 'average', 'stocky', 'tall'];
const HEAD_SHAPES = ['square', 'round', 'long'];
const SHIRT_STYLES = ['tee', 'collared', 'vest', 'henley', 'tank'];
const PANTS_STYLES = ['trousers', 'jeans', 'shorts'];
const ACCESSORIES = [
  'cap_forward', 'cap_backward', 'beanie', 'fedora', 'bandana',
  'shades', 'glasses_round', 'glasses_square',
  'watch_left', 'chain_gold', 'chain_silver', 'earring_l', 'earring_r', 'earrings',
  'cigar', 'toothpick', 'wristband',
];
const ACC_LABELS = {
  cap_forward: '🧢 Cap', cap_backward: '🧢 Cap ↩', beanie: '🧶 Beanie',
  fedora: '🎩 Fedora', bandana: '🔴 Bandana',
  shades: '🕶️ Shades', glasses_round: '👓 Round', glasses_square: '📐 Square',
  watch_left: '⌚ Watch', chain_gold: '🔗 Gold', chain_silver: '🔗 Silver',
  earring_l: '💎 L Ear', earring_r: '💎 R Ear', earrings: '💎 Both',
  cigar: '🚬 Cigar', toothpick: '🪥 Pick', wristband: '💪 Band',
};

// ---------------------------------------------------------------- 预览渲染器
function createPreview(container) {
  const w = 220, h = 340;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.borderRadius = '8px';
  renderer.domElement.style.background = 'rgba(0,0,0,0.3)';

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, w / h, 0.1, 10);
  cam.position.set(0, 1.1, 2.8);
  cam.lookAt(0, 0.85, 0);

  scene.add(new THREE.AmbientLight(0xffd7a8, 0.7));
  const spot = new THREE.DirectionalLight(0xffe2b0, 1.2);
  spot.position.set(1, 2, 1.5);
  scene.add(spot);

  let avatar = null, spin = 0, dragX = 0, dragging = false;

  renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; dragX = e.clientX; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (dragging) { spin += (e.clientX - dragX) * 0.01; dragX = e.clientX; }
  });

  return {
    setAvatar(av) {
      if (avatar) { scene.remove(avatar.group); avatar.dispose(); }
      avatar = av;
      scene.add(avatar.group);
    },
    render() {
      if (!dragging) spin += 0.008;
      if (avatar) { avatar.group.rotation.y = spin; avatar.update(1 / 60); }
      renderer.render(scene, cam);
    },
    dispose() {
      if (avatar) { scene.remove(avatar.group); avatar.dispose(); }
      renderer.dispose();
    },
    renderer,
  };
}

// ---------------------------------------------------------------- UI 构建
function buildUI() {
  const overlay = document.createElement('div');
  overlay.id = 'avatar-customizer';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background:rgba(12,8,6,0.92); display:flex; align-items:center; justify-content:center;
    font-family:system-ui,sans-serif; color:#e8dcc8;
  `;

  overlay.innerHTML = `
    <div style="display:flex;gap:24px;max-width:720px;width:100%;padding:20px">
      <div style="flex:0 0 auto">
        <div style="text-align:center;font-size:13px;color:#a89878;margin-bottom:8px">
          <button id="cust-p1" class="cust-slot on">P1</button>
          <button id="cust-p2" class="cust-slot">P2</button>
        </div>
        <div id="cust-preview" style="width:220px;height:340px"></div>
      </div>
      <div style="flex:1;min-width:0">
        <h2 style="margin:0 0 12px;font-size:18px;color:#d4af37;text-transform:uppercase;letter-spacing:2px">Customize Avatar</h2>
        <div id="cust-tabs" style="display:flex;gap:4px;margin-bottom:12px">
          <button class="cust-tab on" data-tab="body">Body</button>
          <button class="cust-tab" data-tab="head">Head</button>
          <button class="cust-tab" data-tab="clothes">Clothes</button>
          <button class="cust-tab" data-tab="acc">Accessories</button>
        </div>
        <div id="cust-panel" style="background:rgba(0,0,0,0.3);border-radius:8px;padding:14px;height:240px;overflow-y:auto"></div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
          <button id="cust-random" style="background:#5a4a3a;border:none;color:#e8dcc8;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px">🎲 Random</button>
          <button id="cust-cancel" style="background:#3a2a2a;border:none;color:#e8dcc8;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px">✗ Cancel</button>
          <button id="cust-save" style="background:#2a5a2a;border:none;color:#e8dcc8;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold">✓ Save</button>
        </div>
      </div>
    </div>
  `;

  // 内联样式 for 按钮类
  const style = document.createElement('style');
  style.textContent = `
    .cust-slot { background:rgba(100,80,60,0.3);border:1px solid #5a4a3a;color:#a89878;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px }
    .cust-slot.on { background:#5a4a3a;color:#d4af37;border-color:#d4af37 }
    .cust-tab { background:rgba(100,80,60,0.2);border:1px solid #3a2a1a;color:#a89878;padding:6px 12px;border-radius:6px 6px 0 0;cursor:pointer;font-size:13px;flex:1 }
    .cust-tab.on { background:rgba(0,0,0,0.3);color:#d4af37;border-color:#5a4a3a;border-bottom-color:transparent }
    .cust-swatch { display:inline-block;width:28px;height:28px;border-radius:50%;cursor:pointer;margin:3px;border:2px solid transparent;transition:border-color 0.15s }
    .cust-swatch.on { border-color:#d4af37;box-shadow:0 0 6px rgba(212,175,55,0.4) }
    .cust-swatch:hover { border-color:#a89878 }
    .cust-opt { display:inline-block;background:rgba(100,80,60,0.2);border:1px solid #3a2a1a;color:#a89878;padding:5px 10px;border-radius:4px;cursor:pointer;margin:3px;font-size:12px }
    .cust-opt.on { background:#5a4a3a;color:#d4af37;border-color:#d4af37 }
    .cust-acc { display:inline-block;background:rgba(100,80,60,0.15);border:1px solid #3a2a1a;color:#a89878;padding:6px 10px;border-radius:6px;cursor:pointer;margin:3px;font-size:12px }
    .cust-acc.on { background:rgba(212,175,55,0.15);color:#d4af37;border-color:#d4af37 }
    .cust-label { display:block;color:#a89878;font-size:12px;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px }
    .cust-label:first-child { margin-top:0 }
    #cust-panel::-webkit-scrollbar { width:6px }
    #cust-panel::-webkit-scrollbar-thumb { background:#5a4a3a;border-radius:3px }
  `;
  overlay.appendChild(style);
  return overlay;
}

// ---------------------------------------------------------------- 面板内容渲染
function renderPanel(panel, tab, cfg, onChange) {
  let html = '';

  const swatches = (label, palette, current, key) => {
    html += `<span class="cust-label">${label}</span><div>`;
    for (const [name, hex] of Object.entries(palette)) {
      const c = '#' + hex.toString(16).padStart(6, '0');
      html += `<span class="cust-swatch${current === name ? ' on' : ''}" data-key="${key}" data-val="${name}" style="background:${c}" title="${name}"></span>`;
    }
    html += '</div>';
  };

  const options = (label, opts, current, key) => {
    html += `<span class="cust-label">${label}</span><div>`;
    for (const o of opts) {
      html += `<button class="cust-opt${current === o ? ' on' : ''}" data-key="${key}" data-val="${o}">${o}</button>`;
    }
    html += '</div>';
  };

  switch (tab) {
    case 'body':
      options('Body Type', BODY_TYPES, cfg.body, 'body');
      html += `<span class="cust-label">Height</span><div style="display:flex;align-items:center;gap:8px">
        <input type="range" min="85" max="115" value="${Math.round(cfg.height * 100)}" data-key="height" style="flex:1;accent-color:#d4af37">
        <span id="cust-height-val" style="font-size:12px;color:#d4af37;min-width:40px">${cfg.height.toFixed(2)}×</span>
      </div>`;
      swatches('Skin Tone', SKIN, cfg.skin, 'skin');
      break;
    case 'head':
      options('Head Shape', HEAD_SHAPES, cfg.headShape, 'headShape');
      options('Hair Style', HAIR_STYLES, cfg.hair, 'hair');
      swatches('Hair Color', HAIR_COLOR, cfg.hairColor, 'hairColor');
      break;
    case 'clothes':
      options('Shirt Style', SHIRT_STYLES, cfg.shirtStyle, 'shirtStyle');
      swatches('Shirt Color', CLOTH_COLOR, cfg.shirtColor, 'shirtColor');
      options('Pants Style', PANTS_STYLES, cfg.pantsStyle, 'pantsStyle');
      swatches('Pants Color', CLOTH_COLOR, cfg.pantsColor, 'pantsColor');
      swatches('Shoe Color', CLOTH_COLOR, cfg.shoeColor, 'shoeColor');
      break;
    case 'acc':
      html += '<span class="cust-label">Toggle Accessories</span><div>';
      for (const a of ACCESSORIES) {
        const on = (cfg.accessories || []).includes(a);
        html += `<button class="cust-acc${on ? ' on' : ''}" data-acc="${a}">${ACC_LABELS[a] || a}</button>`;
      }
      html += '</div>';
      break;
  }

  panel.innerHTML = html;

  // 绑定事件
  panel.querySelectorAll('.cust-swatch, .cust-opt').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.key, val = el.dataset.val;
      cfg[key] = val;
      onChange();
      renderPanel(panel, tab, cfg, onChange);
    });
  });

  panel.querySelectorAll('.cust-acc').forEach((el) => {
    el.addEventListener('click', () => {
      const a = el.dataset.acc;
      const accs = cfg.accessories || [];
      // 帽子排他组
      const HAT = ['cap_forward', 'cap_backward', 'beanie', 'fedora', 'bandana'];
      if (accs.includes(a)) {
        cfg.accessories = accs.filter((x) => x !== a);
      } else {
        if (HAT.includes(a)) cfg.accessories = accs.filter((x) => !HAT.includes(x));
        cfg.accessories = [...(cfg.accessories || []), a];
      }
      onChange();
      renderPanel(panel, tab, cfg, onChange);
    });
  });

  const slider = panel.querySelector('input[data-key="height"]');
  if (slider) {
    slider.addEventListener('input', () => {
      cfg.height = +slider.value / 100;
      const lbl = panel.querySelector('#cust-height-val');
      if (lbl) lbl.textContent = cfg.height.toFixed(2) + '×';
      onChange();
    });
  }
}

// ---------------------------------------------------------------- 公开 API
export function openCustomizer(playerSlot = 0, onSave = null) {
  const overlay = buildUI();
  document.body.appendChild(overlay);

  const storeKey = playerSlot === 0 ? 'avatar_p1' : 'avatar_p2';
  const cfg = { ...DEFAULT_CONFIG, ...store.get(storeKey, {}) };
  let currentTab = 'body';
  let currentSlot = playerSlot;

  const previewContainer = overlay.querySelector('#cust-preview');
  const preview = createPreview(previewContainer);
  const panel = overlay.querySelector('#cust-panel');

  let avatar = new Avatar(cfg);
  preview.setAvatar(avatar);

  const refresh = () => {
    avatar = new Avatar(cfg);
    preview.setAvatar(avatar);
  };
  renderPanel(panel, currentTab, cfg, refresh);

  // 预览动画循环
  let raf;
  const loop = () => { preview.render(); raf = requestAnimationFrame(loop); };
  loop();

  // 选项卡
  overlay.querySelectorAll('.cust-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.cust-tab').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      currentTab = btn.dataset.tab;
      renderPanel(panel, currentTab, cfg, refresh);
    });
  });

  // P1/P2 切换
  const switchSlot = (slot) => {
    currentSlot = slot;
    const key = slot === 0 ? 'avatar_p1' : 'avatar_p2';
    Object.assign(cfg, { ...DEFAULT_CONFIG, ...store.get(key, {}) });
    overlay.querySelector('#cust-p1').classList.toggle('on', slot === 0);
    overlay.querySelector('#cust-p2').classList.toggle('on', slot === 1);
    refresh();
    renderPanel(panel, currentTab, cfg, refresh);
  };
  overlay.querySelector('#cust-p1').addEventListener('click', () => switchSlot(0));
  overlay.querySelector('#cust-p2').addEventListener('click', () => switchSlot(1));

  // 随机
  overlay.querySelector('#cust-random').addEventListener('click', () => {
    const rng = mulberry32(Date.now());
    cfg.body = rng.pick(BODY_TYPES);
    cfg.height = 0.9 + rng() * 0.2;
    cfg.skin = rng.pick(Object.keys(SKIN));
    cfg.headShape = rng.pick(HEAD_SHAPES);
    cfg.hair = rng.pick(HAIR_STYLES);
    cfg.hairColor = rng.pick(Object.keys(HAIR_COLOR));
    cfg.shirtStyle = rng.pick(SHIRT_STYLES);
    cfg.shirtColor = rng.pick(Object.keys(CLOTH_COLOR));
    cfg.pantsStyle = rng.pick(PANTS_STYLES);
    cfg.pantsColor = rng.pick(Object.keys(CLOTH_COLOR));
    cfg.shoeColor = rng.pick(['black', 'brown', 'tan', 'white']);
    const nAcc = rng.int(0, 3);
    cfg.accessories = [];
    for (let i = 0; i < nAcc; i++) cfg.accessories.push(rng.pick(ACCESSORIES));
    cfg.accessories = [...new Set(cfg.accessories)];
    refresh();
    renderPanel(panel, currentTab, cfg, refresh);
  });

  const close = () => {
    cancelAnimationFrame(raf);
    preview.dispose();
    overlay.remove();
  };

  // 保存
  overlay.querySelector('#cust-save').addEventListener('click', () => {
    const key = currentSlot === 0 ? 'avatar_p1' : 'avatar_p2';
    store.set(key, cfg);
    close();
    if (onSave) onSave(cfg, currentSlot);
  });

  // 取消
  overlay.querySelector('#cust-cancel').addEventListener('click', close);

  // Esc 关闭
  const escHandler = (e) => { if (e.code === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  return { close };
}
