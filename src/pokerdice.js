// 骰子扑克的玩法控制器：状态机 + 屏幕上的 UI。物理在 dice.js（DiceTray），渲染在 world.js。
// 流程：bet（下注）→ rolling（你抛骰）→ hold（留骰 / 重投，最多 3 投）→ showdown（庄家摇盅、揭盅）→ result

import { DiceTray, TRAY, rackX, rankHand, compareHands, describeHand, playHouse, HANDS, PAYOUT } from './dice.js';
import { mulberry32 } from './rng.js';

export function createPokerDice({ THREE, RAPIER, world, audio, chips, saveChips, toast, unlock, t, $ }) {
  const MAX_ROLLS = 3;
  const g = {
    state: 'bet', stake: 10, tray: null, house: null, hand: null, streak: 0,
    clock: 0, rattleT: 0, last: null, showRanks: false, cache: {},
  };
  const rng = mulberry32((Math.random() * 1e9) | 0);

  const handText = (h) => { const d = describeHand(h); return t('hand.' + d.kind, { a: d.a, b: d.b }); };

  // ---------------- UI（只在文字变化时才写 DOM）
  function setText(id, html) { if (g.cache[id] !== html) { g.cache[id] = html; $(id).innerHTML = html; } }
  const key = (k) => `<kbd>${k}</kbd>`;

  function renderRanks() {
    setText('dice-ranks', `<div class="rk-title">${t('dice.ranks')}</div>` + [...HANDS].map((k, i) => {
      const sample = { high: '1 2 3 4 6', pair: '2 2 3 4 6', twoPair: '2 2 5 5 6', trips: '3 3 3 4 6', straight: '1 2 3 4 5', fullHouse: '4 4 4 2 2', four: '5 5 5 5 1', five: '6 6 6 6 6' }[k];
      return `<div class="rk"><span class="rk-n">${t('hand.name.' + k)}</span><span class="rk-s">${sample}</span><span class="rk-p">${t('dice.pays', { n: PAYOUT[k] })}</span></div>`;
    }).reverse().join(''));
  }

  function updateUI() {
    const s = g.state, tray = g.tray;
    setText('dice-chips', `<span class="chip">●</span> ${t('dice.chips', { n: chips.balance })} &nbsp;·&nbsp; ${t('dice.stake', { n: g.stake })}${s === 'bet' || s === 'result' ? ' <span class="upd">▲▼</span>' : ''}`);
    // 你的牌
    let hl = '', sub = '';
    if (tray && (s === 'hold' || s === 'showdown' || s === 'result') && g.hand) {
      hl = `<span class="lbl">${t('dice.yourHand')}</span><b>${handText(g.hand)}</b>`;
      if (s === 'hold') sub = tray.rollNo >= MAX_ROLLS ? t('dice.lastRoll') : `${t('dice.roll', { n: tray.rollNo })} · ${t('dice.rollsLeft', { n: MAX_ROLLS - tray.rollNo })}`;
    } else if (s === 'rolling') hl = `<b>${t('dice.rolling')}</b>`;
    else if (s === 'bet') hl = `<b>${t('dice.place')}</b>`;
    setText('dice-hand', hl + (sub ? `<div class="sub">${sub}</div>` : ''));
    const hintKey = s === 'showdown' || s === 'rolling' ? 'house' : s;
    setText('dice-hint', hintKey === 'house' ? t('dice.hint.house') : t('dice.hint.' + hintKey).split(' · ').map((x) => { const i = x.indexOf(' '); return i > 0 ? `${key(x.slice(0, i))}${x.slice(i)}` : x; }).join(' &nbsp; '));
    if (g.showRanks) renderRanks();
    $('dice-ranks').hidden = !g.showRanks;
  }

  // 标签跟着骰子走（投影到屏幕）
  function placeTags() {
    const cam = world.camera;
    const proj = (x, y, z) => { const v = world.diceLocal(x, y, z).project(cam); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, ok: v.z < 1 }; };
    const tags = $('dice-tags').children;
    const showHold = g.state === 'hold' && g.tray;
    for (let i = 0; i < 5; i++) {
      const el = tags[i]; if (!el) continue;
      if (!showHold) { el.hidden = true; continue; }
      const p = proj(rackX(i), 0.075, TRAY.rackZ + 0.01);
      el.hidden = !p.ok; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      el.classList.toggle('held', g.tray.held[i]);
      const lab = g.tray.held[i] ? `${i + 1}<small>${t('dice.hold')}</small>` : `${i + 1}`;
      if (el.dataset.l !== lab) { el.dataset.l = lab; el.innerHTML = lab; }
    }
    const hl = $('dice-houselabel');
    const showHouse = g.state !== 'bet' && g.house;
    hl.hidden = !showHouse;
    if (showHouse) {
      const p = proj(0, 0.15, TRAY.houseZ - 0.03);
      hl.style.left = p.x + 'px'; hl.style.top = p.y + 'px';
      const rev = g.state === 'result' || (g.state === 'showdown' && g.clock > 2.4);
      setText('dice-houselabel', `<span class="lbl">${t('dice.house')}</span>` + (rev ? `<b>${handText(g.house.rank)}</b>` : '<b>?</b>'));
    }
  }

  // ---------------- 流程
  function reset() {
    g.tray?.dispose(); g.tray = null; g.house = null; g.hand = null; g.last = null;
    world.setPlayerDice(null); world.setHouseDice(null);
    world.setDiceGlow(0, 0); world.setDiceGlow(1, 0);
    $('dice-result').hidden = true; g.state = 'bet';
  }

  function deal() {
    if (!chips.bet(g.stake)) { toast(t('dice.noChips'), 1400); return; }
    saveChips();
    reset();
    g.tray = new DiceTray(RAPIER, { seed: (Math.random() * 1e9) | 0 });
    const h = playHouse(rng);
    g.house = { ...h, rank: rankHand(h.faces) };
    world.setHouseDice({ faces: h.faces, lift: 0, shake: 0 });
    throwNow([0, 1, 2, 3, 4]);
    g.state = 'rolling';
  }

  function throwNow(idx) {
    if (!g.tray.throwDice(idx)) return false;
    audio.play('rattle');
    [250, 470, 720].forEach((ms) => setTimeout(() => { if (g.tray?.phase === 'rolling') audio.play(ms > 500 ? 'click' : 'thud', { gain: 0.7 }); }, ms));
    return true;
  }

  function showdown() {
    g.state = 'showdown'; g.clock = 0; g.rattleT = 0; g.revealed = false;
    for (let i = 0; i < 5; i++) g.tray.held[i] = false;
    world.setHouseDice({ faces: g.house.faces, lift: 0, shake: 1 });
  }

  function finish() {
    const out = compareHands(g.hand, g.house.rank);
    const kind = g.hand.kind;
    let msg, cls, delta = 0;
    if (out === 'win') {
      delta = g.stake * PAYOUT[kind];
      chips.pay(g.stake + delta);
      msg = t('dice.win', { n: delta }); cls = 'win'; g.streak++; audio.play('cheer');
      if (g.streak >= 3) unlock('diceStreak');
    } else if (out === 'lose') {
      msg = t('dice.lose', { n: g.stake }); cls = 'lose'; g.streak = 0; audio.play('foul'); delta = -g.stake;
    } else { chips.pay(g.stake); msg = t('dice.push'); cls = 'push'; }
    let refill = '';
    if (chips.balance < 5) { chips.balance = 50; refill = t('dice.refill'); }
    g.stake = Math.min(g.stake, Math.max(5, chips.balance));
    saveChips();
    g.last = { out, delta };
    const el = $('dice-result');
    el.className = 'panel ' + cls; el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    const bonus = out === 'win' && PAYOUT[kind] > 1 ? `<div class="bonus">${t('dice.bonus', { h: t('hand.name.' + kind), n: PAYOUT[kind] })}</div>` : '';
    el.innerHTML = `<div class="big">${msg}</div><div class="vs">${handText(g.hand)} <i>vs</i> ${handText(g.house.rank)}</div>${bonus}${refill ? `<div class="bonus">${refill}</div>` : ''}`;
    world.setDiceGlow(0, out === 'win' ? 0.55 : 0, 0x5fe08a);
    world.setDiceGlow(1, out === 'lose' ? 0.55 : 0, 0xff5a4a);
    g.state = 'result';
  }

  // ---------------- 对外接口
  g.enter = function enter() {
    $('dice-ui').hidden = false; $('mini').hidden = true;
    world.setDiceActive(true);
    g.cache = {};
    if (g.state === 'bet') reset();
    updateUI();
  };
  g.leave = function leave() {
    $('dice-ui').hidden = true;
    reset(); g.state = 'bet'; world.setDiceActive(false);
  };
  g.onKey = function onKey(code) {
    const s = g.state;
    if (code === 'KeyH') { g.showRanks = !g.showRanks; return; }
    if (s === 'bet' || s === 'result') {
      if (code === 'ArrowUp' || code === 'Equal') g.stake = Math.min(Math.max(5, chips.balance), g.stake + 5);
      else if (code === 'ArrowDown' || code === 'Minus') g.stake = Math.max(5, g.stake - 5);
      else if (code === 'Space' || code === 'Enter') deal();
      return;
    }
    if (s === 'hold') {
      const m = /^(?:Digit|Numpad)([1-5])$/.exec(code);
      if (m) { g.tray.toggleHold(+m[1] - 1); audio.play('click'); return; }
      if (code === 'Enter') { showdown(); return; }
      if (code === 'Space') {
        if (g.tray.rollNo >= MAX_ROLLS || g.tray.held.every(Boolean)) { showdown(); return; }
        g.state = 'rolling'; throwNow();
      }
    }
  };
  g.update = function update(dt) {
    const tray = g.tray;
    // 相机：俯视整张桌子，近端是你的骰架，远端是庄家的骰盅；摊牌时微微前推
    const sd = g.state === 'showdown' || g.state === 'result';
    world.setCameraTarget(world.diceLocal(0, sd ? 0.66 : 0.68, sd ? 0.62 : 0.65), world.diceLocal(0, 0, sd ? -0.07 : -0.04), { fov: 40, k: 4 });

    if (tray) {
      tray.step(dt);
      world.setPlayerDice(tray.snapshot());
      if (g.state === 'rolling' && tray.phase === 'ready') {
        g.state = 'hold'; g.hand = rankHand(tray.faces); audio.play('place');
        if (tray.rollNo >= MAX_ROLLS) setTimeout(() => { if (g.state === 'hold') showdown(); }, 1500);
      }
      if (tray.phase === 'ready' && g.state === 'hold') g.hand = rankHand(tray.faces);
    }
    if (g.state === 'showdown') {
      g.clock += dt;
      if (g.clock < 1.6) {
        g.rattleT -= dt; if (g.rattleT <= 0) { audio.play('rattle'); g.rattleT = 0.4; }
        world.setHouseDice({ lift: 0, shake: 1 });
      } else if (g.clock < 2.4) {
        const u = (g.clock - 1.6) / 0.8; world.setHouseDice({ lift: u * u * (3 - 2 * u), shake: 0 });
        if (!g.revealed) { g.revealed = true; audio.play('thud'); }
      } else if (g.clock >= 3.0) finish();
      else world.setHouseDice({ lift: 1, shake: 0 });
    }
    placeTags();
    updateUI();
  };
  return g;
}
