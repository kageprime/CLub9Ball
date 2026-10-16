// 入口：把物理(sim)、规则(rules)、渲染(world)、音频、回放、小游戏串起来。
// 数据流向：输入 → sim（唯一事实源）→ 快照 → world（只读渲染）。world 永远不写回 sim。
//
// 对局模式（G.settings.mode）：cpu 人机对战 · twop 双人同屏 · practice 练习 · watch 电脑对电脑
// 回合状态（G.mode）：walk 走动 · aim 瞄准 · place 摆自由球 · cpu 电脑回合 · striking/rolling 出杆/球在滚 · replay · darts/dice/roulette

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { Sim } from './sim.js';
import { newMatch, resolveShot, resolvePractice, remainingOf, onEight } from './rules.js';
import { World, TABLE_Y, ROOM } from './world.js';
import { AudioEngine } from './audio.js';
import { ReplayRecorder, ReplayPlayer, FRAME_FLOATS } from './replay.js';
import { DartsGame } from './darts.js';
import { Chips, Roulette } from './bar.js';
import { createPokerDice } from './pokerdice.js';
import { pickShot, pickPlacement, legalTargets } from './ai.js';
import { CameraRig, CAMS, CAM_KEYS } from './cameras.js';
import { mulberry32 } from './rng.js';
import { initLang, setLang, getLang, onLang, t, applyDom } from './i18n.js';
import { BALL_R, HALF_L, HALF_W, POCKETS, colorOf, groupOf } from './table.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem('club9.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('club9.' + k, JSON.stringify(v)); } catch (_) { /* 隐私模式 */ } },
};

// ---------------------------------------------------------------- 状态
const MODES = ['cpu', 'twop', 'practice', 'watch'];
const DIFFS = ['easy', 'normal', 'hard'];
// 电脑难度：skill 越高角度误差越小；noiseScale 放大误差；sloppy 是“看走眼”选错线的概率；think 是出杆前的思考时间（秒）
const DIFF = {
  easy:   { skill: 0.35, noiseScale: 2.6, sloppy: 0.6,  think: [1.0, 1.8], aim: 1.1 },
  normal: { skill: 0.7,  noiseScale: 1.25, sloppy: 0.2, think: [0.8, 1.5], aim: 0.95 },
  hard:   { skill: 0.94, noiseScale: 0.7, sloppy: 0,    think: [0.6, 1.1], aim: 0.8 },
};
const G = {
  started: false, paused: false, spectate: false, opp: 'cpu', touch: false,
  mode: 'walk',
  player: { x: -2.3, z: 0, yaw: 0, pitch: -0.15 },
  aim: { angle: 0, power: 0.5, sx: 0, sy: 0, charging: false },
  cursor: { x: 0, y: 0 },  // 虚拟光标（NDC），自由球与飞镖用
  settings: { closeup: true, aimline: true, volume: 0.8, pixel: 360, mode: 'cpu', diff: 'normal', cam: 'auto', ...store.get('settings', {}) },
  achieved: new Set(store.get('ach', [])),
  match: null, potted: [[], []], stats: null,
  lastShot: null, replay: null, closeup: null, rollCam: null,
  keys: new Set(), msgTimer: 0, nearProp: null,
  wasBreak: false, shotStartMatch: null, endTimer: null,
  camAngle: 0, lastCue: null, cueVel: { x: 0, z: 0 }, dt: 0.016, lamps: true, lastTurn: -1,
};
window.__club9 = G; // 调试用（G.games 在文件后面挂上）

// 内部渲染分辨率默认 270p → 360p：旧存档里的 270 多数只是旧默认值，做一次性迁移（可在设置里改回）
if (!store.get('px360')) {
  if (G.settings.pixel === 270) { G.settings.pixel = 360; saveSettings(); }
  store.set('px360', true);
}
const rig = new CameraRig(TABLE_Y);
rig.set(G.settings.cam);

let sim, world, audio, recorder, chips, aiRng;
const snapBuf = new Float32Array(FRAME_FLOATS);
const sampleBuf = new Float32Array(FRAME_FLOATS);
const ACH_IDS = ['firstPot', 'combo3', 'breakPot', 'clear', 'eightWin', '180', 'diceStreak', 'roulette3'];

// ---------------------------------------------------------------- 回合归属：谁是电脑
const isCpuPlayer = (p) => G.spectate || (G.opp === 'cpu' && G.match?.mode === 'match' && p === 1);
const cpuTurn = () => !!G.match && G.match.phase !== 'ended' && isCpuPlayer(G.match.turn);
function playerName(i) {
  if (G.spectate) return t('player.cpu', { n: i + 1 });
  if (G.opp === 'cpu') return i === 0 ? t('player.you') : t('player.cpuSolo');
  return t('player.' + (i + 1));
}

// ---------------------------------------------------------------- 工具：提示 / HUD
function toast(text, ms = 2200) {
  const el = $('msg'); el.textContent = text; el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  G.msgTimer = ms / 1000;
}

function unlock(id) {
  if (G.achieved.has(id)) return;
  G.achieved.add(id); store.set('ach', [...G.achieved]);
  const el = $('achtoast'); el.textContent = '★ ' + t('ach.unlocked', { n: t('ach.' + id) }); el.hidden = false;
  clearTimeout(unlock._t); unlock._t = setTimeout(() => { el.hidden = true; }, 3200);
  audio?.play('achieve');
  renderBadges();
}
function renderBadges() {
  $('badges').innerHTML = ACH_IDS.map((id) => `<span class="badge ${G.achieved.has(id) ? 'on' : ''}" title="${t('ach.' + id)}">★</span>`).join('');
  $('ach-list').innerHTML = ACH_IDS.map((id) => `<div class="ach ${G.achieved.has(id) ? 'on' : ''}">${t('ach.' + id)}<small>${t('ach.' + id + '.d')}</small></div>`).join('');
}

function ballIcon(n, on = true) {
  return `<span class="ball ${n > 8 ? 'stripe' : ''} ${on ? '' : 'out'}" style="background:${colorOf(n)}"><span>${n}</span></span>`;
}
function groupLabel(p) {
  const g = G.match.groups[p];
  if (!g) return t('hud.group.open');
  return t('hud.group.' + g);
}
// 已定组：显示该组 7 颗 + 黑八，落袋的变暗（一眼看出还剩几颗）；未定组：显示已进的球
function trackerBalls(i) {
  const g = G.match.groups[i];
  if (!g) return G.potted[i].map((n) => ballIcon(n)).join('');
  const nums = g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  return [...nums, 8].map((n) => ballIcon(n, G.match.onTable.has(n))).join('');
}
function modeText() {
  const m = G.match, id = G.settings.mode;
  let s = t('mode.' + id);
  if (id === 'cpu') s += ' · ' + t('diff.' + G.settings.diff);
  if (m.ballInHand) s += ' · ' + t('hud.freeBall');
  return s;
}
function renderHUD() {
  const m = G.match; if (!m) return;
  const practice = m.mode === 'practice';
  for (let i = 0; i < 2; i++) {
    const p = i + 1;
    $(`p${p}-name`).textContent = playerName(i);
    $(`p${p}-group`).textContent = practice ? (i === 0 ? t('hud.mode.practice') : '') : groupLabel(i);
    $(`p${p}-balls`).innerHTML = practice ? G.potted[0].map((n) => ballIcon(n)).join('') : trackerBalls(i);
    const active = practice ? i === 0 : m.turn === i;
    $(`hud-p${p}`).classList.toggle('idle', !active);
    $(`p${p}-combo`).innerHTML = active && m.combo >= 2 ? `<span class="flame">🔥</span> ${t('hud.combo', { n: m.combo })}` : '';
  }
  $('hud-p2').style.display = practice ? 'none' : '';
  $('mode-label').textContent = modeText();
  renderTurn();
  renderKeyHint();
}
function renderTurn() {
  const el = $('turnbar'), m = G.match;
  if (!m || !G.started || m.phase === 'ended') { el.hidden = true; return; }
  let text, cls = '';
  if (m.mode === 'practice') text = t('turn.practice');
  else {
    const p = m.turn, nm = playerName(p), cpuT = cpuTurn();
    if (cpuT) text = t(cpu.phase === 'aim' || cpu.phase === 'draw' || cpu.phase === 'fired' ? 'turn.lining' : 'turn.thinking', { p: nm });
    else text = (G.opp === 'cpu' && !G.spectate) ? t('turn.you') : t('turn.name', { p: nm });
    const extra = m.breakShot ? t('turn.break') : m.ballInHand ? t('turn.ballInHand') : onEight(m, p) ? t('turn.eight') : '';
    if (extra) text += ' · ' + extra;
    cls = cpuT ? 'cpu' : 'you';
  }
  el.className = 'panel ' + cls; el.hidden = false;
  if (el.dataset.k !== text) { el.dataset.k = text; $('turn-text').textContent = text; }
}
function renderKeyHint() {
  const k = { walk: 'walk', aim: 'aim', place: 'place', cpu: 'cpu', darts: 'minigame', dice: 'minigame', roulette: 'minigame' }[G.mode];
  $('keyhint').textContent = k === 'cpu' ? t('key.hint.cpu', { p: G.match ? playerName(G.match.turn) : '' }) : k ? t('key.hint.' + k) : '';
}
function renderPower() {
  const bar = $('power-bar');
  if (!bar.children.length) {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('div'); s.className = 'seg';
      const k = i / 11; s.style.setProperty('--c', `hsl(${18 + k * 40} 90% ${48 + k * 28}%)`);
      bar.appendChild(s);
    }
  }
  const n = Math.round(G.aim.power * 12);
  [...bar.children].forEach((s, i) => s.classList.toggle('on', i < n));
}
function renderSpin() {
  const c = $('spin'), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 48, 48);
  g.fillStyle = '#f2ecda'; g.beginPath(); g.arc(24, 24, 20, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.fillRect(14, 12, 6, 5);
  g.strokeStyle = '#99907a'; g.lineWidth = 1; g.beginPath(); g.moveTo(24, 6); g.lineTo(24, 42); g.moveTo(6, 24); g.lineTo(42, 24); g.stroke();
  g.fillStyle = '#d02a1c'; g.fillRect(Math.round(24 + G.aim.sx * 15) - 3, Math.round(24 - G.aim.sy * 15) - 3, 6, 6);
}

// ---------------------------------------------------------------- 镜头
function renderCamBar() {
  $('cam-chips').innerHTML = CAMS.map((c, i) => `<button class="cam-chip ${rig.mode === c ? 'on' : ''}" data-cam="${c}"><i>${i + 1}</i>${t('cam.' + c)}</button>`).join('');
}
function setCam(mode, quiet = false) {
  rig.set(mode); G.settings.cam = rig.mode; saveSettings(); renderCamBar();
  if (!quiet) toast(rig.mode === 'orbit' ? t('msg.camOrbit') : t('msg.cam', { c: t('cam.' + rig.mode) }), rig.mode === 'orbit' ? 2600 : 900);
}
function cycleCam(step) { setCam(rig.next(step)); }

// 每帧：问相机机位要目标（phase：'aim' 瞄准 / 'roll' 球在滚）
function driveCamera(phase) {
  const c = sim.ballPos(0) || G.lastCue || { x: 0, z: 0 };
  const res = rig.compute(phase, cpuTurn(), { cue: c, angle: G.camAngle, rollCam: G.rollCam, vel: G.cueVel, dt: G.dt });
  world.setCameraTarget(res.pos, res.look, { fov: res.fov, k: res.k });
  G.lamps = res.lamps;
}
function orbitKeys(dt) {
  if (!['aim', 'cpu', 'rolling', 'striking'].includes(G.mode)) return;
  const k = G.keys;
  const yaw = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
  const pit = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
  const zm = (k.has('BracketRight') ? 1 : 0) - (k.has('BracketLeft') ? 1 : 0);
  if (!yaw && !pit && !zm) return;
  if (rig.mode !== 'orbit') setCam('orbit');
  rig.nudgeOrbit(yaw * 1.6 * dt, pit * 1.0 * dt, -zm * 1.5 * dt);
}

// ---------------------------------------------------------------- 对局
function freshStats() { return { shots: [0, 0], fouls: [0, 0], best: [0, 0] }; }

function newGame(mode = G.match?.mode || 'match', silent = false) {
  clearTimeout(G.endTimer);
  $('over').hidden = true;
  G.match = newMatch(); G.match.mode = mode;
  G.potted = [[], []]; G.stats = freshStats(); G.lastTurn = -1;
  sim.rerack();
  recorder.reset();
  G.aim.sx = G.aim.sy = 0; G.aim.power = 0.5;
  world.setCue({ visible: false }); world.setAimLine(null);
  if (!silent) toast(t(mode === 'match' ? 'msg.rerack' : 'msg.mode.practice'));
  renderHUD(); renderPower(); renderSpin();
  if (G.started) startTurn(true);
}

// 一杆结束 / 新局开始后，决定下一步是谁、什么状态
function startTurn(keepWalk = false) {
  if (!G.started) return;
  const m = G.match;
  if (G.mode === 'rolling' || G.mode === 'striking') G.mode = 'aim';
  if (m.phase === 'ended') { G.mode = 'walk'; renderTurn(); return; }
  if (cpuTurn()) {
    G.mode = 'cpu'; cpuReset();
  } else {
    const needPlace = !sim.cueOnTable() || (m.mode === 'match' && m.ballInHand);
    if (needPlace) enterPlace(true);
    else if (!(keepWalk && G.mode === 'walk')) {
      G.mode = 'aim';
      if (G.lastTurn !== m.turn) { G.aim.angle = defaultAimAngle(); G.aim.power = 0.5; }
    }
  }
  G.lastTurn = m.turn;
  renderTurn(); renderKeyHint();
}

// 默认瞄向最近的合法目标球
function defaultAimAngle() {
  const c = sim.ballPos(0); if (!c) return 0;
  const balls = sim.objectBalls();
  const legal = new Set(legalTargets(G.match, balls));
  let best = null, bd = 1e9;
  for (const b of balls) { if (!legal.has(b.n)) continue; const d = Math.hypot(b.x - c.x, b.z - c.z); if (d < bd) { bd = d; best = b; } }
  return best ? Math.atan2(best.z - c.z, best.x - c.x) : 0;
}

function powerParams() {
  return { angle: G.aim.angle, power: G.aim.power, spinX: G.aim.sx, spinY: G.aim.sy };
}

function doShoot(p) {
  if (!sim.cueOnTable() || sim.phase !== 'idle') return;
  const c = sim.ballPos(0);
  G.mode = 'striking'; G.camAngle = p.angle;
  world.setCue({ visible: true, x: c.x, z: c.z, angle: p.angle, sx: p.spinX, sy: p.spinY, pull: world.cueState.pull });
  // 滚动镜头（“球后”机位用）：从击球点后上方俯看
  const d = { x: Math.cos(p.angle), z: Math.sin(p.angle) };
  G.rollCam = {
    pos: new THREE.Vector3(c.x - d.x * 0.95, TABLE_Y + 0.62, c.z - d.z * 0.95),
    look: new THREE.Vector3(c.x + d.x * 0.7, TABLE_Y, c.z + d.z * 0.7),
  };
  world.cueStrike(() => {
    audio.play('cue', { speed: 1 + p.power * 6 });
    recorder.begin(sim.snapshotInto(snapBuf), { player: G.match.turn, ...p });
    G.wasBreak = sim.racked;
    sim.strike(p);
    G.mode = 'rolling';
    world.setAimLine(null);
  });
}

function panFor(x, z) {
  const cam = world.camera, right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const rel = new THREE.Vector3(x, TABLE_Y, z).sub(cam.position);
  return clamp(rel.dot(right) / 2.0, -0.9, 0.9);
}

let hitBudget = 0;
function handleSimEvents(live) {
  const events = sim.drainEvents();
  hitBudget = 6;
  for (const e of events) {
    if (live && recorder.active) {
      const keep = { type: e.type };
      if (e.ball != null) keep.ball = e.ball; if (e.a != null) { keep.a = e.a; keep.b = e.b; }
      if (e.speed != null) keep.speed = e.speed; if (e.pocket != null) keep.pocket = e.pocket;
      if (e.type !== 'shotEnd' && e.type !== 'strike') recorder.addEvent(keep);
    }
    if (e.type === 'strike') { if (e.isBreak) audio.play('break'); }
    else if (e.type === 'ballHit') {
      if (e.speed > 0.05 && hitBudget-- > 0) { const p = sim.ballPos(e.a); audio.play('hit', { speed: e.speed, pan: p ? panFor(p.x, p.z) : 0 }); }
    } else if (e.type === 'cushion') {
      if (e.speed > 0.06 && hitBudget-- > 0) { const p = sim.ballPos(e.ball); audio.play('cushion', { speed: e.speed, pan: p ? panFor(p.x, p.z) : 0 }); }
    } else if (e.type === 'pocket') {
      audio.play('pocket', { speed: e.speed });
      if (e.ball !== 0) setTimeout(() => audio.play('cheer', { gain: 0.6 }), 350);
      if (G.settings.closeup && e.pocket >= 0 && e.ball !== 0 && live) startCloseup(POCKETS[e.pocket]);
    } else if (e.type === 'shotEnd') {
      onShotEnd(e.report);
    }
  }
}

function startCloseup(p) {
  const l = Math.hypot(p.x, p.z) || 1, ux = -p.x / l, uz = -p.z / l;
  G.closeup = {
    t: 1.5,
    pos: new THREE.Vector3(p.x + ux * 0.5 - uz * 0.12, TABLE_Y + 0.2, p.z + uz * 0.5 + ux * 0.12),
    look: new THREE.Vector3(p.x, TABLE_Y + 0.0, p.z),
  };
}

function onShotEnd(report) {
  G.lastShot = recorder.finish() || G.lastShot;
  const m0 = G.match;
  const res = m0.mode === 'practice' ? resolvePractice(m0, report) : resolveShot(m0, report);
  G.match = res.match;
  const shooter = m0.turn;
  G.stats.shots[shooter]++;
  let anyPot = false, ended = null;
  for (const ev of res.events) {
    if (ev.type === 'pocket') {
      anyPot = true;
      (G.potted[m0.mode === 'practice' ? 0 : ev.player] ||= []).push(ev.ball);
      if (!isCpuPlayer(shooter)) unlock('firstPot');
    } else if (ev.type === 'groupAssigned') {
      toast(t('msg.groupAssigned', { p: playerName(ev.player), g: t('hud.group.' + ev.group) }));
    } else if (ev.type === 'continue') {
      G.stats.best[shooter] = Math.max(G.stats.best[shooter], ev.combo);
      if (ev.combo >= 2) { toast(t('msg.combo', { n: ev.combo })); }
      if (ev.combo >= 3 && !isCpuPlayer(shooter)) unlock('combo3');
    } else if (ev.type === 'foul') {
      G.stats.fouls[ev.player]++;
      audio.play('foul');
      const why = ev.reasons.map((r) => t('foul.' + r)).join(' / ');
      toast(t('msg.foul', { r: why, p: playerName(1 - ev.player) }), 3200);
    } else if (ev.type === 'switch') {
      toast(t('msg.switch', { p: playerName(ev.player) }));
    } else if (ev.type === 'eightRespot') {
      sim.respotBall(8); toast(t('msg.eightRespot'), 2800);
    } else if (ev.type === 'gameEnd') {
      ended = ev;
      audio.play('cheer');
      if (ev.reason === 'eightWin' && !isCpuPlayer(ev.winner)) unlock('eightWin');
    }
  }
  if (!isCpuPlayer(shooter) && G.wasBreak && anyPot && report.pocketed.some((b) => b !== 0 && b !== 8)) unlock('breakPot');
  if (m0.mode !== 'practice') {
    const g = G.match.groups[shooter];
    if (g && remainingOf(G.match, shooter) === 0 && !isCpuPlayer(shooter)) unlock('clear');
  } else if (G.match.onTable.size === 0) {
    toast(t('msg.rerack'));
    G.endTimer = setTimeout(() => newGame('practice', true), 2500);
  }
  G.wasBreak = false;
  G.closeup = G.closeup && G.closeup.t > 0 ? G.closeup : null;
  renderHUD();
  if (ended) { showOver(ended.winner, ended.reason); G.mode = 'walk'; return; }
  startTurn();
}

// ---------------------------------------------------------------- 终局画面
function showOver(winner, reason) {
  if (G.spectate) {                      // 观战：不弹窗，几秒后自动再来一局
    toast(t('msg.win', { p: playerName(winner) }), 4200);
    G.endTimer = setTimeout(() => newGame('match', true), 6000);
    return;
  }
  const vsCpu = G.opp === 'cpu';
  const title = $('over-title');
  title.textContent = vsCpu ? (winner === 0 ? t('over.winYou') : t('over.lose')) : t('over.winP', { p: playerName(winner) });
  title.className = vsCpu && winner === 1 ? 'lose' : '';
  const key = 'over.why.' + reason;
  $('over-why').textContent = t(key) === key ? '' : t(key);
  const S = G.stats, sc = G.match.scores;
  const row = (label, a, b) => `<tr><td>${label}</td><td class="${winner === 0 ? 'w' : ''}">${a}</td><td class="${winner === 1 ? 'w' : ''}">${b}</td></tr>`;
  $('over-stats').innerHTML = `<tr><th></th><th>${playerName(0)}</th><th>${playerName(1)}</th></tr>`
    + row(t('over.potted'), sc[0], sc[1]) + row(t('over.shots'), S.shots[0], S.shots[1])
    + row(t('over.fouls'), S.fouls[0], S.fouls[1]) + row(t('over.combo'), S.best[0], S.best[1]);
  setTimeout(() => {
    if (G.match.phase !== 'ended') return;
    $('over').hidden = false; document.exitPointerLock?.(); document.body.classList.add('free');
  }, 1400);          // 留一点时间看最后一球落袋
}
function rematch() {
  $('over').hidden = true;
  newGame(G.match.mode, true);
  if (!G.spectate) lock();
}

// 结束当前对局，回到主菜单（暂停菜单“结束对局”）
function quitToMenu() {
  if (G.mode === 'darts' || G.mode === 'dice' || G.mode === 'roulette') leaveMini();
  clearTimeout(G.endTimer);
  G.started = false; G.paused = false; G.replay = null; G.mode = 'walk';
  G.keys.clear(); G.aim.charging = false;
  showPause(false);
  $('over').hidden = true; $('replay').hidden = true; $('prompt').hidden = true;
  document.exitPointerLock?.();
  document.body.classList.remove('free', 'in-mini', 'spectating');
  world.setCue({ visible: false }); world.setAimLine(null);
  setReticle(false); G.closeup = null;
  sim.rerack();
  $('hud').hidden = true;
  $('start').hidden = false; $('loading').hidden = true; $('btn-start').hidden = false; $('start-pick').hidden = G.touch;
  renderPickers();
}

// ---------------------------------------------------------------- 自由球
function enterPlace(auto = false) {
  if (G.mode === 'rolling' || G.mode === 'striking') return;
  G.mode = 'place'; G.cursor.x = 0; G.cursor.y = 0;
  world.setCue({ visible: false });
  world.setAimLine(null);
  toast(t('msg.freeBall'), 2600);
  renderKeyHint();
}
function confirmPlace() {
  const pt = world.pickTable(G.cursor);
  if (!pt) return;
  if (sim.placeCue(pt.x, pt.z, { behindHead: G.match.breakShot })) {
    audio.play('place'); G.match.ballInHand = false; G.mode = 'aim'; renderHUD();
    G.aim.angle = defaultAimAngle();
  } else { audio.play('foul'); toast(t('msg.cantPlace'), 1200); }
}

// ---------------------------------------------------------------- 移动 / 碰撞
function walkCollide(p) {
  p.x = clamp(p.x, -3.9, 3.9); p.z = clamp(p.z, -1.7, 2.35);
  const hx = HALF_L + 0.44 + 0.3, hz = HALF_W + 0.44 + 0.3;
  if (Math.abs(p.x) < hx && Math.abs(p.z) < hz) {
    const px = hx - Math.abs(p.x), pz = hz - Math.abs(p.z);
    if (px < pz) p.x = Math.sign(p.x || -1) * hx; else p.z = Math.sign(p.z || 1) * hz;
  }
  const dx = p.x - 2.9, dz = p.z + 1.9, r = 0.95, d = Math.hypot(dx, dz);
  if (d < r) { p.x = 2.9 + (dx / (d || 1)) * r; p.z = -1.9 + (dz / (d || 1)) * r; }
}

function updateWalk(dt) {
  const P = G.player, k = G.keys;
  const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
  const sp = (k.has('ShiftLeft') ? 3.0 : 1.7) * dt;
  if (f || s) {
    const fx = Math.cos(P.yaw), fz = Math.sin(P.yaw), rx = -fz, rz = fx;
    const l = Math.hypot(f, s);
    P.x += ((fx * f + rx * s) / l) * sp; P.z += ((fz * f + rz * s) / l) * sp;
    walkCollide(P);
  }
  const eye = new THREE.Vector3(P.x, 1.65, P.z);
  const look = eye.clone().add(new THREE.Vector3(Math.cos(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), Math.sin(P.yaw) * Math.cos(P.pitch)));
  world.setCameraTarget(eye, look, { fov: 68, k: 40 });
  // 酒吧道具提示
  let near = null, nd = 1e9;
  for (const pr of Object.values(world.props)) {
    const d = Math.hypot(P.x - pr.pos.x, P.z - pr.pos.z);
    if (d < pr.radius && d < nd) { near = pr; nd = d; }
  }
  G.nearProp = near;
  const pe = $('prompt');
  if (near) { pe.textContent = t('bar.prompt', { what: t(near.labelKey) }); pe.hidden = false; } else pe.hidden = true;
  world.setCue({ visible: false });
  world.setAimLine(null);
}

// ---------------------------------------------------------------- 瞄准
function updateAim(dt) {
  if (!sim.cueOnTable()) { enterPlace(true); return; }
  const c = sim.ballPos(0), a = G.aim;
  if (a.charging) { a.power = clamp(a.power + dt * 0.5, 0.05, 1); renderPower(); }
  const pull = 0.05 + a.power * 0.26;
  world.setCue({ visible: true, x: c.x, z: c.z, angle: a.angle, pull, elev: 0.07, sx: a.sx, sy: a.sy });
  world.setAimLine(G.settings.aimline ? sim.aimTrace(a.angle) : null);
  G.camAngle = a.angle; driveCamera('aim');
  $('prompt').hidden = true;
}

function updatePlace() {
  world.setCameraTarget(new THREE.Vector3(0, TABLE_Y + 2.05, 1.55), new THREE.Vector3(0, TABLE_Y, 0.05), { fov: 56, k: 10 });
  const pt = world.pickTable(G.cursor);
  const ghost = world.balls[0];
  if (pt) {
    ghost.visible = true; ghost.position.set(clamp(pt.x, -HALF_L + BALL_R, HALF_L - BALL_R), BALL_R, clamp(pt.z, -HALF_W + BALL_R, HALF_W - BALL_R));
  }
  const v = new THREE.Vector3(pt ? pt.x : 0, TABLE_Y + BALL_R, pt ? pt.z : 0).project(world.camera);
  const rct = canvas.getBoundingClientRect();   // 画布居中且整数倍放大，准星换算到画布坐标系
  setReticle(true, rct.left + (v.x * 0.5 + 0.5) * rct.width, rct.top + (-v.y * 0.5 + 0.5) * rct.height);
}
function setReticle(on, x = 0, y = 0, ghost = false) {
  const r = $('reticle'); r.hidden = !on; if (!on) return;
  r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.toggle('ghost', ghost);
}

// ---------------------------------------------------------------- 回放
function enterReplay() {
  if (!G.lastShot) { toast(t('msg.replayNone')); return; }
  if (G.mode === 'rolling' || G.mode === 'striking' || G.mode === 'darts' || G.mode === 'dice' || G.mode === 'roulette') return;
  G.replayPrev = G.mode;
  G.replay = new ReplayPlayer(G.lastShot);
  G.mode = 'replay';
  world.setCue({ visible: false }); world.setAimLine(null);
  $('replay').hidden = false; $('prompt').hidden = true;
  $('rp-speed').value = 1; $('rp-speed-val').textContent = '1.0×';
  document.exitPointerLock?.();
  updateReplayUI();
}
function exitReplay() {
  G.replay = null; $('replay').hidden = true;
  G.mode = G.replayPrev && G.replayPrev !== 'replay' ? G.replayPrev : 'walk';
  if (G.mode === 'rolling') G.mode = 'aim';
  sim.snapshotInto(snapBuf); world.syncBalls(snapBuf, 0);
  setTimeout(() => { if (!document.pointerLockElement && !G.spectate) lock(); }, 0);
  setTimeout(() => { if (!document.pointerLockElement && !G.spectate && G.started && lockTries === 0) showPause(true); }, 400);
}
function updateReplayUI() {
  const r = G.replay; if (!r) return;
  $('rp-seek').value = Math.round(r.progress * 1000);
  $('replay-time').textContent = `${r.time.toFixed(1)} / ${r.duration.toFixed(1)} s`;
  $('rp-play').textContent = r.playing ? t('replay.pause') : t('replay.play');
}
function updateReplay(dt) {
  const r = G.replay;
  for (const e of r.update(dt)) {
    if (e.type === 'ballHit') audio.play('hit', { speed: e.speed });
    else if (e.type === 'cushion') audio.play('cushion', { speed: e.speed });
    else if (e.type === 'pocket') audio.play('pocket', { speed: e.speed });
  }
  world.syncBalls(r.frame(), dt);
  world.setCameraTarget(new THREE.Vector3(0, TABLE_Y + 1.5, 1.75), new THREE.Vector3(0, TABLE_Y, 0.05), { fov: 56, k: 10 });
  updateReplayUI();
}

// ---------------------------------------------------------------- 电脑回合（人机 / 观战共用）
// wait（思考）→ aim（球杆缓缓转向目标）→ draw（拉杆）→ 出杆。出杆后由 onShotEnd → startTurn 接力。
const cpu = { phase: 'wait', timer: 1, shot: null, t: 0, from: 0, angle: 0, drawT: 0 };
const diffCfg = () => (G.spectate ? DIFF.normal : DIFF[G.settings.diff] || DIFF.normal);

function cpuReset() {
  const cfg = diffCfg();
  cpu.phase = 'wait'; cpu.timer = cfg.think[0] + Math.random() * (cfg.think[1] - cfg.think[0]); cpu.shot = null;
  world.setCue({ visible: false }); world.setAimLine(null);
  const c = sim.ballPos(0);
  G.camAngle = c ? Math.atan2(-c.z, 0.4 - c.x) : 0;
  renderTurn();
}

function updateCpu(dt) {
  const m = G.match;
  if (m.phase === 'ended' || sim.phase !== 'idle') return;
  const cfg = diffCfg();
  driveCamera('aim');
  if (cpu.phase === 'wait') {
    cpu.timer -= dt;
    if (cpu.timer > 0) return;
    if (!sim.cueOnTable() || m.ballInHand) {
      const pt = pickPlacement({ balls: sim.objectBalls(), match: m, breaking: m.breakShot });
      if (!sim.placeCue(pt.x, pt.z, { behindHead: m.breakShot })) sim.placeCue(-0.6, 0.1);
      m.ballInHand = false; audio.play('place'); renderHUD();
    }
    const c = sim.ballPos(0);
    cpu.shot = pickShot({ cue: c, balls: sim.objectBalls(), match: m, rng: aiRng, skill: cfg.skill, noiseScale: cfg.noiseScale, sloppy: cfg.sloppy, breaking: m.breakShot });
    cpu.from = cpu.shot.angle + (Math.random() - 0.5) * 0.9; cpu.t = 0; cpu.phase = 'aim'; renderTurn();
  } else if (cpu.phase === 'aim') {
    cpu.t += dt;
    const c = sim.ballPos(0), s = cpu.shot, u = Math.min(1, cpu.t / cfg.aim), e = u * u * (3 - 2 * u);
    cpu.angle = cpu.from + (s.angle - cpu.from) * e;
    G.camAngle = cpu.angle;
    world.setCue({ visible: true, x: c.x, z: c.z, angle: cpu.angle, pull: 0.05, elev: 0.07, sx: s.spinX, sy: s.spinY });
    world.setAimLine(G.settings.aimline ? sim.aimTrace(cpu.angle) : null);
    if (u >= 1) { cpu.phase = 'draw'; cpu.drawT = 0; renderTurn(); }
  } else if (cpu.phase === 'draw') {
    cpu.drawT += dt;
    const c = sim.ballPos(0), s = cpu.shot, u = Math.min(1, cpu.drawT / 0.7);
    G.camAngle = s.angle;
    world.setCue({ visible: true, x: c.x, z: c.z, angle: s.angle, pull: 0.05 + u * s.power * 0.26, elev: 0.07, sx: s.spinX, sy: s.spinY });
    if (u >= 1) {
      cpu.phase = 'fired';
      world.cueState.pull = 0.05 + s.power * 0.26;
      doShoot({ angle: s.angle, power: s.power, spinX: s.spinX, spinY: s.spinY });
    }
  }
}

// ---------------------------------------------------------------- 小游戏
const mini = {
  show(title, lines, hint) {
    $('mini').hidden = false; $('mini-title').textContent = title;
    $('mini-lines').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    $('mini-hint').textContent = hint || '';
  },
  hide() { $('mini').hidden = true; },
};
function enterMini(id) {
  G.mode = id; $('prompt').hidden = true; world.setCue({ visible: false }); world.setAimLine(null);
  G.cursor.x = G.cursor.y = 0;
  document.body.classList.add('in-mini');
  games[id].enter();
  renderKeyHint();
}
function leaveMini() {
  games[G.mode]?.leave?.();
  mini.hide(); setReticle(false); G.mode = 'walk'; document.body.classList.remove('in-mini'); renderKeyHint();
}

const games = {
  // ---- 飞镖
  darts: {
    game: null, aim: { x: 0, y: 0 }, flying: null, clearAt: 0, lastText: '', t: 0,
    enter() {
      if (!this.game) this.game = new DartsGame({ seed: (Math.random() * 1e9) | 0, skill: 0.85 });
      this.aim = { x: 0, y: 0 }; this.flying = null;
      const sp = world.props.darts.spot;
      this.eye = new THREE.Vector3(sp.x, 1.72, sp.z);
      world.setCameraTarget(this.eye, world.dartToWorld(0, 0), { fov: 24, k: 12 });
    },
    leave() { world.flyingDart.visible = false; world.clearDarts(); this.game.reset(); },
    onMouse(dx, dy) { this.aim.x = clamp(this.aim.x + dx * 0.00028, -0.24, 0.24); this.aim.y = clamp(this.aim.y - dy * 0.00028, -0.24, 0.24); },
    sway() { const t = this.t; return { x: 0.006 * Math.sin(t * 1.9) + 0.003 * Math.sin(t * 5.3), y: 0.006 * Math.cos(t * 1.4) + 0.003 * Math.cos(t * 4.7) }; },
    onClick() {
      if (this.flying) return;
      const sw = this.sway();
      const r = this.game.throwDart({ x: this.aim.x + sw.x, y: this.aim.y + sw.y }, { power: 0.5 });
      this.flying = { r, t: 0, from: this.eye.clone().add(new THREE.Vector3(0.3, -0.12, 0.08)), to: world.dartToWorld(r.x, r.y) };
      world.flyingDart.visible = true; audio.play('click');
    },
    update(dt) {
      this.t += dt;
      world.setCameraTarget(this.eye, world.dartToWorld(0, 0), { fov: 24, k: 12 });
      if (this.clearAt && performance.now() > this.clearAt) { world.clearDarts(); this.clearAt = 0; }
      const f = this.flying;
      if (f) {
        f.t += dt / 0.32; const u = Math.min(1, f.t);
        world.flyingDart.position.lerpVectors(f.from, f.to, u); world.flyingDart.position.y += Math.sin(u * Math.PI) * 0.05;
        if (u >= 1) {
          world.flyingDart.visible = false;
          if (f.r.ring !== 'miss') world.addDartHit(f.r.x, f.r.y);
          audio.play(f.r.ring === 'miss' ? 'thud' : 'dart');
          this.lastText = f.r.ring === 'miss' ? t('darts.ring.miss') : (f.r.ring === 'bull' || f.r.ring === 'outerBull') ? `${t('darts.ring.' + f.r.ring)} (${f.r.score})` : t('darts.hit', { ring: t('darts.ring.' + f.r.ring), sector: f.r.sector, score: f.r.score });
          if (f.r.roundDone) {
            toast(t('darts.roundEnd', { s: f.r.roundScore }), 2200);
            if (f.r.events.some((e) => e.type === 'badge')) { unlock('180'); toast(t('darts.180'), 3200); audio.play('cheer'); }
            this.clearAt = performance.now() + 1800;
          }
          this.flying = null;
        }
      }
      const sw = this.sway(), wp = world.dartToWorld(this.aim.x + sw.x, this.aim.y + sw.y).project(world.camera);
      const rct = canvas.getBoundingClientRect();   // 画布居中且整数倍放大，准星要按画布矩形换算
      setReticle(true, rct.left + (wp.x * 0.5 + 0.5) * rct.width, rct.top + (-wp.y * 0.5 + 0.5) * rct.height);
      const g = this.game;
      mini.show(t('darts.title'), [t('darts.round', { s: g.roundSoFar() }), t('darts.total', { s: g.total }), g.round.map((d) => d.score).join(' · ') || '—', this.lastText], t('darts.hint'));
    },
  },

  // ---- 骰子扑克（见 pokerdice.js；boot 里创建）
  dice: null,

  // ---- 俄罗斯轮盘
  roulette: {
    r: null, stake: 20, active: false, banked: 1, survived: 0, cyl: 0, text: '',
    enter() {
      if (!this.r) this.r = new Roulette({ seed: (Math.random() * 1e9) | 0 });
      const p = world.props.roulette.pos;
      this.cam = [new THREE.Vector3(p.x + 0.62, p.y + 0.3, p.z + 0.2), new THREE.Vector3(p.x, p.y + 0.05, p.z)];
      world.setCameraTarget(this.cam[0], this.cam[1], { fov: 40, k: 10 });
    },
    leave() { if (this.active) { this.active = false; this.text = ''; } },
    pot() { return Math.round(this.stake * this.banked * this.r.multiplier()); },
    onKey(code) {
      if (!this.active) {
        if (code === 'ArrowUp') this.stake = Math.min(Math.max(10, chips.balance), this.stake + 10);
        else if (code === 'ArrowDown') this.stake = Math.max(10, this.stake - 10);
        else if (code === 'Space') {
          if (!chips.bet(this.stake)) { toast(t('dice.noChips'), 1400); return; }
          saveChips();
          this.r.reset(); this.active = true; this.banked = 1; this.survived = 0; this.text = '';
          this.cyl += 1 + ((Math.random() * 6) | 0); world.setRevolverCylinder(this.cyl); audio.play('rattle');
        }
        return;
      }
      if (code === 'Space') {
        const res = this.r.pull();
        this.cyl += 1; world.setRevolverCylinder(this.cyl); world.hammerFall();
        if (res.bang) {
          audio.play('bang'); world.flash(0xff2a14, 0.9);
          this.text = t('roulette.bang', { n: this.stake }); this.active = false;
          if (chips.balance < 10) chips.balance = 50; saveChips();
        } else {
          audio.play('click'); this.survived++; this.text = t('roulette.click');
          if (this.survived >= 3) unlock('roulette3');
        }
      } else if (code === 'KeyR') {
        this.banked *= this.r.multiplier(); this.r.spin(); this.cyl += 2 + ((Math.random() * 6) | 0);
        world.setRevolverCylinder(this.cyl); audio.play('rattle');
      } else if (code === 'Enter') {
        const win = this.pot(); chips.pay(win); saveChips();
        this.text = t('roulette.cash', { n: win - this.stake }); this.active = false; audio.play('cheer');
      }
    },
    update() {
      world.setCameraTarget(this.cam[0], this.cam[1], { fov: 40, k: 10 });
      const lines = [t('roulette.chips', { n: chips.balance }), t('roulette.stake', { n: this.stake })];
      if (this.active) { lines.push(t('roulette.pot', { n: this.pot() })); lines.push(t('roulette.odds', { p: Math.round(this.r.safeOdds() * 100) })); }
      else lines.push(t('roulette.start', { n: this.stake }));
      if (this.text) lines.push(this.text);
      mini.show(t('roulette.title'), lines, t('roulette.hint'));
    },
  },
};
function saveChips() { store.set('chips', chips.balance); }
G.games = games; G.startTurn = () => startTurn(); G.showOver = showOver;

// ---------------------------------------------------------------- 输入
const canvas = $('gl');
// 指针锁重试：Chromium 在按 Esc 退出锁后 ~1.25 s 内会拒绝再次加锁（chromium issue 40148473），
// 静默失败会让玩家卡在“没有锁、又打不开暂停菜单”的状态，所以失败要自动重试。
let lockTries = 0, lockTimer = 0;
function lock() {
  if (!G.started || G.spectate || document.pointerLockElement === canvas) return;
  clearTimeout(lockTimer); lockTries = 0;
  const attempt = () => {
    if (document.pointerLockElement === canvas || !G.started || G.spectate || G.paused) return;
    lockTries++;
    try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch (_) { /* 忽略 */ }
    lockTimer = setTimeout(() => {
      if (document.pointerLockElement === canvas) return;
      if (lockTries < 3) attempt();
      else if (!G.paused && !anyDialog()) showPause(true);   // 实在锁不上：把暂停菜单还给玩家
    }, 1400);
  };
  attempt();
}
function resumeGame() {
  if (G.spectate) { showPause(false); return; }
  showPause(false);
  lock();
}
function showPause(on) {
  G.paused = on; $('pause').hidden = !on; document.body.classList.toggle('free', on || G.mode === 'replay' || G.spectate);
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) { clearTimeout(lockTimer); lockTries = 0; }
  document.body.classList.toggle('free', !locked || G.spectate);
  if (!G.started || G.spectate) return;
  if (!locked && G.mode !== 'replay' && !anyDialog()) showPause(true);
  if (locked) showPause(false);
});
function anyDialog() { return !$('settings').hidden || !$('about').hidden || !$('over').hidden; }

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || G.paused) return;
  const dx = e.movementX, dy = e.movementY;
  if (G.mode === 'walk') {
    G.player.yaw += dx * 0.0022; G.player.pitch = clamp(G.player.pitch - dy * 0.0022, -1.2, 1.2);
  } else if (G.mode === 'aim') {
    const fine = G.keys.has('ShiftLeft') || G.keys.has('ShiftRight') ? 0.25 : 1;
    G.aim.angle += dx * 0.0011 * fine;
  } else if (G.mode === 'place') {
    G.cursor.x = clamp(G.cursor.x + dx / innerWidth * 2, -1, 1); G.cursor.y = clamp(G.cursor.y - dy / innerHeight * 2, -1, 1);
  } else if (G.mode === 'darts') games.darts.onMouse(dx, dy);
});
document.addEventListener('mousedown', (e) => {
  if (!G.started || G.paused || e.button !== 0) return;
  if (document.pointerLockElement !== canvas) {
    if (e.target === canvas && !G.spectate && !anyDialog()) lock();   // 失去指针锁后，点画面即可重新接管鼠标
    return;
  }
  if (G.mode === 'aim') { G.aim.charging = true; }
  else if (G.mode === 'place') confirmPlace();
  else if (G.mode === 'darts') games.darts.onClick();
});
document.addEventListener('mouseup', () => { G.aim.charging = false; });
document.addEventListener('wheel', (e) => {
  if (G.mode === 'aim' && !G.paused) { G.aim.power = clamp(G.aim.power - Math.sign(e.deltaY) * 0.04, 0.05, 1); renderPower(); }
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (!G.started) return;
  const c = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
  if (c === 'KeyM') { const m = audio.toggleMute(); toast(t(m ? 'msg.muted' : 'msg.unmuted'), 1000); return; }
  if (c === 'Escape' && G.mode !== 'replay') {
    if (G.paused) { resumeGame(); return; }                                  // Esc 再按一次 = 继续
    if (document.pointerLockElement !== canvas) { showPause(true); return; } // 没有指针锁时（含观战）随时可暂停
  }
  if (G.paused) return;
  G.keys.add(c);
  if (!$('over').hidden) { if (c === 'Enter') rematch(); return; }
  if (G.mode === 'replay') {
    if (c === 'KeyV' || c === 'Escape') exitReplay();
    else if (c === 'Space') { const r = G.replay; if (r.finished) { r.seek(0); r.playing = true; } else r.playing = !r.playing; }
    return;
  }
  if (G.mode === 'darts' || G.mode === 'dice' || G.mode === 'roulette') {
    if (c === 'KeyQ') leaveMini(); else games[G.mode].onKey?.(c);
    return;
  }
  // 镜头：1–7 直达，C / Shift+C 循环
  if (CAM_KEYS[c]) { setCam(CAM_KEYS[c]); return; }
  if (c === 'KeyC') { cycleCam(e.shiftKey ? -1 : 1); return; }
  if (G.spectate) { if (c === 'KeyV') enterReplay(); return; }
  if (G.mode === 'cpu') {
    if (c === 'KeyV') enterReplay();
    else if (c === 'KeyB') { G.settings.aimline = !G.settings.aimline; saveSettings(); toast(t(G.settings.aimline ? 'msg.aimOn' : 'msg.aimOff'), 900); }
    else if (c === 'KeyT') newGame(G.match.mode);
    return;
  }
  if (G.mode === 'rolling' || G.mode === 'striking') return;
  switch (c) {
    case 'KeyE': if (G.mode === 'walk') { G.mode = 'aim'; G.aim.angle = Math.atan2(Math.sin(G.player.yaw), Math.cos(G.player.yaw)); renderKeyHint(); } else if (G.mode === 'aim') { G.mode = 'walk'; renderKeyHint(); } break;
    case 'KeyQ': if (G.mode === 'walk' && G.nearProp) enterMini(G.nearProp.id); break;
    case 'Space': if (G.mode === 'aim') doShoot(powerParams()); break;
    case 'KeyF': G.mode === 'place' ? (G.mode = 'aim', renderKeyHint()) : enterPlace(); break;
    case 'KeyT': newGame(G.match.mode); break;
    case 'KeyG': if (G.settings.mode === 'cpu' || G.settings.mode === 'twop' || G.settings.mode === 'practice') { G.settings.mode = G.match.mode === 'match' ? 'practice' : (G.opp === 'cpu' ? 'cpu' : 'twop'); } newGame(G.match.mode === 'match' ? 'practice' : 'match', true); applyMode(false); toast(t('msg.mode.' + G.match.mode)); break;
    case 'KeyV': enterReplay(); break;
    case 'KeyR': if (G.mode === 'aim') { G.aim.sx = G.aim.sy = 0; renderSpin(); } break;
    case 'KeyB': G.settings.aimline = !G.settings.aimline; saveSettings(); toast(t(G.settings.aimline ? 'msg.aimOn' : 'msg.aimOff'), 900); break;
    default: break;
  }
  if (G.mode === 'aim') {
    const st = 0.1;
    if (c === 'KeyA') G.aim.sx -= st; else if (c === 'KeyD') G.aim.sx += st; else if (c === 'KeyW') G.aim.sy += st; else if (c === 'KeyS') G.aim.sy -= st;
    const l = Math.hypot(G.aim.sx, G.aim.sy); if (l > 1) { G.aim.sx /= l; G.aim.sy /= l; }
    G.aim.sx = Math.round(G.aim.sx * 10) / 10; G.aim.sy = Math.round(G.aim.sy * 10) / 10;
    if (['KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(c)) renderSpin();
  }
});
document.addEventListener('keyup', (e) => G.keys.delete(e.code));
window.addEventListener('blur', () => G.keys.clear());
window.addEventListener('resize', () => world?.resize());

// ---------------------------------------------------------------- 模式选择（开始画面 + 暂停菜单共用）
function renderPickers() {
  document.querySelectorAll('[data-modes]').forEach((box) => {
    box.innerHTML = MODES.map((id) => `<button class="mode-card ${G.settings.mode === id ? 'on' : ''}" data-mode="${id}"><b>${t('mode.' + id)}</b><small>${t('mode.' + id + '.d')}</small></button>`).join('');
  });
  document.querySelectorAll('[data-diffs]').forEach((box) => {
    box.hidden = G.settings.mode !== 'cpu';
    box.innerHTML = `<span>${t('mode.diff')}</span>` + DIFFS.map((d) => `<button class="btn small ${G.settings.diff === d ? 'on' : ''}" data-diff="${d}">${t('diff.' + d)}</button>`).join('');
  });
}
function applyMode(restart) {
  if (G.mode === 'darts' || G.mode === 'dice' || G.mode === 'roulette') leaveMini();   // 从小游戏切模式时先收尾
  const id = G.settings.mode;
  G.spectate = G.touch || id === 'watch';
  G.opp = id === 'cpu' ? 'cpu' : 'human';
  document.body.classList.toggle('spectating', G.spectate);
  if (G.spectate) document.body.classList.add('free');
  if (restart) newGame(id === 'practice' ? 'practice' : 'match', true);
  renderPickers(); if (G.match) renderHUD();
}
document.addEventListener('click', (e) => {
  const mc = e.target.closest('[data-mode]');
  if (mc) {
    G.settings.mode = mc.dataset.mode; saveSettings();
    if (G.started) { applyMode(true); resumeGame(); } else applyMode(false);
    return;
  }
  const dc = e.target.closest('[data-diff]');
  if (dc) { G.settings.diff = dc.dataset.diff; saveSettings(); renderPickers(); if (G.match) renderHUD(); return; }
  const cc = e.target.closest('[data-cam]');
  if (cc) setCam(cc.dataset.cam);
});

// ---------------------------------------------------------------- 设置 / 面板
function saveSettings() { store.set('settings', G.settings); }
function applySettings() {
  $('set-closeup').checked = G.settings.closeup; $('set-aim').checked = G.settings.aimline;
  $('set-vol').value = G.settings.volume; $('set-pixel').value = String(G.settings.pixel);
  audio?.setVolume(G.settings.volume); world?.setPixelHeight(G.settings.pixel);
}
function fillAbout() {
  const st = { ...world.status };
  const sfx = Object.entries(audio.status).filter(([k]) => k !== 'bgm').map(([, v]) => v);
  const set = (key, val) => { const td = document.querySelector(`[data-status="${key}"]`); if (!td) return; const ok = String(val).startsWith('loaded'); td.textContent = ok ? t('about.loaded') : t('about.fallback'); td.classList.toggle('ok', ok); };
  set('bar', st.bar); set('walnut', st.walnut); set('hdri', st.hdri);
  set('sfx', sfx.length && sfx.every((v) => v === 'loaded') ? 'loaded' : sfx.some((v) => v === 'loaded') ? 'loaded' : 'fallback');
  set('bgm', audio.bgmMode === 'file' ? 'loaded' : 'fallback');
}
function openPanel(id) { $(id).hidden = false; $('pause').hidden = true; if (id === 'about') fillAbout(); if (id === 'settings') renderBadges(); document.exitPointerLock?.(); document.body.classList.add('free'); }
function closePanel(id) { $(id).hidden = true; if (!anyDialog()) { if (G.started && !G.spectate) showPause(true); } }

function bindUI() {
  $('btn-settings').onclick = () => openPanel('settings');
  $('btn-free').onclick = () => { if (G.spectate || G.mode === 'cpu') return; if (G.paused) resumeGame(); if (G.mode === 'aim' || G.mode === 'walk') enterPlace(); };
  $('pz-resume').onclick = () => resumeGame();
  $('pz-settings').onclick = () => openPanel('settings');
  $('pz-about').onclick = () => openPanel('about');
  $('pz-quit').onclick = () => quitToMenu();
  $('set-close').onclick = () => closePanel('settings');
  $('set-about').onclick = () => { $('settings').hidden = true; openPanel('about'); };
  $('about-close').onclick = () => closePanel('about');
  $('over-rematch').onclick = () => rematch();
  $('over-menu').onclick = () => { $('over').hidden = true; showPause(true); };
  $('set-reset').onclick = () => { G.achieved.clear(); store.set('ach', []); renderBadges(); };
  document.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => { setLang(b.dataset.lang); }; });
  $('set-closeup').onchange = (e) => { G.settings.closeup = e.target.checked; saveSettings(); };
  $('set-aim').onchange = (e) => { G.settings.aimline = e.target.checked; saveSettings(); };
  $('set-vol').oninput = (e) => { G.settings.volume = +e.target.value; audio.setVolume(G.settings.volume); saveSettings(); };
  $('set-pixel').onchange = (e) => { G.settings.pixel = +e.target.value; world.setPixelHeight(G.settings.pixel); saveSettings(); };
  $('rp-play').onclick = () => { const r = G.replay; if (!r) return; if (r.finished) { r.seek(0); r.playing = true; } else r.playing = !r.playing; };
  $('rp-seek').oninput = (e) => { const r = G.replay; if (!r) return; r.playing = false; r.seek(+e.target.value / 1000); };
  $('rp-speed').oninput = (e) => { const r = G.replay; if (!r) return; r.setSpeed(+e.target.value); $('rp-speed-val').textContent = r.speed.toFixed(2).replace(/0$/, '') + '×'; };
  $('rp-close').onclick = () => exitReplay();
  $('alt-free').textContent = '自由球'; $('alt-settings').textContent = '设置';
  onLang(() => { renderPickers(); renderCamBar(); if (G.match) renderHUD(); renderBadges(); $('alt-free').textContent = getLang() === 'zh' ? 'FREE BALL' : '自由球'; $('alt-settings').textContent = getLang() === 'zh' ? 'SETTINGS' : '设置'; if (G.replay) updateReplayUI(); if (!$('about').hidden) fillAbout(); });
}

// ---------------------------------------------------------------- 主循环
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  try { update(dt); world.update(dt); world.render(); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}

function update(dt) {
  G.dt = dt; G.lamps = true;
  if (G.msgTimer > 0) { G.msgTimer -= dt; if (G.msgTimer <= 0) $('msg').hidden = true; }
  if (G.closeup) { G.closeup.t -= dt; if (G.closeup.t <= 0) G.closeup = null; }
  if (!G.started) {
    // 开始画面：缓慢环绕球房
    const a = performance.now() / 9000;
    world.setCameraTarget(new THREE.Vector3(Math.cos(a) * 2.6, TABLE_Y + 1.2, Math.sin(a) * 2.0), new THREE.Vector3(0, TABLE_Y, 0), { fov: 58, k: 4 });
    sim.snapshotInto(snapBuf); world.syncBalls(snapBuf, dt);
    return;
  }
  if (G.paused && G.mode !== 'replay') { world.syncBalls(sim.snapshotInto(snapBuf), dt); return; }

  orbitKeys(dt);
  const cp = sim.ballPos(0);
  if (cp) { if (G.lastCue && dt > 0) G.cueVel = { x: (cp.x - G.lastCue.x) / dt, z: (cp.z - G.lastCue.z) / dt }; G.lastCue = { x: cp.x, z: cp.z }; }

  // 物理推进（唯一事实源）
  if (G.mode === 'rolling' || sim.phase === 'rolling') {
    sim.advance(dt);
    handleSimEvents(true);
  }

  switch (G.mode) {
    case 'walk': if (!G.spectate) updateWalk(dt); break;
    case 'aim': updateAim(dt); break;
    case 'place': updatePlace(); break;
    case 'cpu': updateCpu(dt); break;
    case 'striking': driveCamera('aim'); break;
    case 'rolling': driveCamera('roll'); break;
    case 'replay': updateReplay(dt); break;
    case 'darts': case 'dice': case 'roulette': games[G.mode].update(dt); break;
    default: break;
  }
  if (G.mode !== 'darts' && G.mode !== 'place') setReticle(false);

  // 进球特写镜头压过一切机位
  if (G.closeup) { world.setCameraTarget(G.closeup.pos, G.closeup.look, { fov: 46, k: 8 }); G.lamps = true; }
  world.setLampsVisible(G.lamps);

  // 渲染读物理（回放时由 updateReplay 同步）
  if (G.mode !== 'replay') {
    sim.snapshotInto(snapBuf); world.syncBalls(snapBuf, dt);
    if (G.mode === 'place') { const pt = world.pickTable(G.cursor); if (pt) { const b = world.balls[0]; b.visible = true; b.position.set(clamp(pt.x, -HALF_L + BALL_R, HALF_L - BALL_R), BALL_R, clamp(pt.z, -HALF_W + BALL_R, HALF_W - BALL_R)); } }
  }
}

// ---------------------------------------------------------------- 启动
async function boot() {
  initLang(); bindUI(); applyDom(); renderBadges();
  const q = new URLSearchParams(location.search);
  G.touch = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;
  if (q.has('spectate')) G.settings.mode = 'watch';
  if (MODES.includes(q.get('mode'))) G.settings.mode = q.get('mode');
  if (!MODES.includes(G.settings.mode)) G.settings.mode = 'cpu';
  if (G.touch) { document.body.classList.add('touch'); $('start-touch').hidden = false; G.settings.mode = 'watch'; }
  renderPickers(); renderCamBar();
  try { await RAPIER.init(); } catch (e) { $('loading').textContent = 'Rapier 加载失败：' + e; return; }
  chips = new Chips(store.get('chips', 100)); if (chips.balance < 5) chips.balance = 50;
  aiRng = mulberry32(99); aiRng.gauss = aiRng.gauss;
  sim = new Sim(RAPIER, { seed: 9 });
  recorder = new ReplayRecorder();
  sim.onSample = (s) => { if (recorder.active) { s.snapshotInto(sampleBuf); recorder.push(sampleBuf); } };
  audio = new AudioEngine();
  world = new World(canvas);
  await world.init((done, total) => { $('loading-n').textContent = t('loading.assets', { done, total }); });
  games.dice = createPokerDice({ THREE, RAPIER, world, audio, chips, saveChips, toast, unlock, t, $ });
  applySettings();
  applyMode(true);
  G.aim.angle = 0;
  $('loading').hidden = true; $('btn-start').hidden = false; $('start-pick').hidden = G.touch;
  requestAnimationFrame(frame);

  $('btn-start').onclick = async () => {
    await audio.init(); await audio.loadManifest(); audio.setVolume(G.settings.volume); audio.startBGM();
    $('start').hidden = true; $('hud').hidden = false; G.started = true;
    $('spectate').hidden = true;
    G.mode = 'walk';
    applyMode(true);
    if (G.spectate) toast(t(G.touch ? 'msg.touch' : 'mode.watch.d'));
    else { lock(); toast(t('msg.break'), 1600); }
    renderHUD(); renderPower(); renderSpin(); renderCamBar();
    startTurn(true);
  };
}
boot();
