// 本地双人简化中式八球规则。纯逻辑，不依赖物理引擎与 DOM。
// 流程：每杆结束后把本杆事件 shotReport 交给 resolveShot，得到新的 match 状态。
//
// shotReport = {
//   firstContact: number|null,   // 母球首个接触的目标球号
//   pocketed: number[],          // 按落袋顺序的球号（含 0 表示母球落袋）
//   railAfterContact: boolean,   // 首次接触后是否有球碰库边
//   railHits: number,            // 碰库边次数（开球判定用）
// }

import { groupOf } from './table.js';

export function newMatch() {
  return {
    mode: 'match',            // 'match' | 'practice'
    turn: 0,                  // 0 / 1
    groups: [null, null],     // 'solid' | 'stripe'
    phase: 'break',           // 'break' | 'open' | 'play' | 'ended'
    ballInHand: false,        // 下一杆是否自由球
    breakShot: true,
    winner: null,
    scores: [0, 0],           // 记分牌：各自进球数
    combo: 0,                 // 当前玩家连续进球杆数
    onTable: new Set(Array.from({ length: 15 }, (_, i) => i + 1)),
    log: [],
  };
}

export function remainingOf(match, player) {
  const g = match.groups[player];
  if (!g) return null;
  let n = 0;
  for (const b of match.onTable) if (groupOf(b) === g) n++;
  return n;
}

// 该玩家当前是否只剩黑八
export function onEight(match, player) {
  return match.groups[player] !== null && remainingOf(match, player) === 0;
}

// 判定本杆犯规，返回犯规原因代码数组（空 = 无犯规）
export function detectFouls(match, rep) {
  const fouls = [];
  const p = match.turn;
  if (rep.pocketed.includes(0)) fouls.push('scratch');
  if (rep.firstContact == null) {
    fouls.push('noContact');
  } else if (!match.breakShot) {
    const g = groupOf(rep.firstContact);
    const mine = match.groups[p];
    if (mine === null) {
      if (g === 'eight') fouls.push('wrongBall');
    } else if (onEight(match, p)) {
      if (g !== 'eight') fouls.push('wrongBall');
    } else if (g !== mine) {
      fouls.push('wrongBall');
    }
  }
  const objPocketed = rep.pocketed.filter((b) => b !== 0);
  if (fouls.length === 0 && rep.firstContact != null && objPocketed.length === 0 && !rep.railAfterContact) {
    fouls.push('noRail');
  }
  return fouls;
}

// 返回 { match, fouls, events } ；events 是供 UI/成就/音效使用的语义事件
export function resolveShot(prev, rep) {
  const m = {
    ...prev,
    groups: [...prev.groups],
    scores: [...prev.scores],
    onTable: new Set(prev.onTable),
    log: [...prev.log],
  };
  const events = [];
  const p = prev.turn;
  const opp = 1 - p;

  if (m.phase === 'ended') return { match: m, fouls: [], events };

  const fouls = detectFouls(prev, rep);
  const objPocketed = rep.pocketed.filter((b) => b !== 0);
  for (const b of objPocketed) m.onTable.delete(b);

  // 开球：黑八落袋 → 重新摆放黑八，继续比赛（不判负）
  let eightRespot = false;
  if (prev.breakShot && objPocketed.includes(8)) {
    eightRespot = true;
    m.onTable.add(8);
    events.push({ type: 'eightRespot' });
  }
  const effPocketed = eightRespot ? objPocketed.filter((b) => b !== 8) : objPocketed;

  // 记分（按落袋球号计到“落袋者”本杆玩家名下，花色归属定后再统计一次）
  if (m.groups[p] === null && !fouls.length && effPocketed.some((b) => b !== 8)) {
    // 开放球台：首个合法落袋球定组
    const first = effPocketed.find((b) => b !== 8);
    const g = groupOf(first);
    m.groups[p] = g;
    m.groups[opp] = g === 'solid' ? 'stripe' : 'solid';
    if (m.phase === 'open' || m.phase === 'break') m.phase = 'play';
    events.push({ type: 'groupAssigned', player: p, group: g });
  }
  for (const b of effPocketed) {
    if (b === 8) continue;
    const owner = m.groups[p] && groupOf(b) === m.groups[p] ? p
      : m.groups[opp] && groupOf(b) === m.groups[opp] ? opp : p;
    m.scores[owner] += 1;
    events.push({ type: 'pocket', ball: b, player: owner });
  }

  // 黑八结算
  if (effPocketed.includes(8)) {
    const clearedBefore = prev.groups[p] !== null && remainingOf(prev, p) === 0;
    if (!clearedBefore || fouls.length) {
      m.winner = opp;
    } else {
      m.winner = p;
    }
    m.phase = 'ended';
    events.push({ type: 'gameEnd', winner: m.winner, reason: fouls.length ? 'eightFoul' : (clearedBefore ? 'eightWin' : 'eightEarly') });
    m.breakShot = false;
    return { match: m, fouls, events };
  }

  // 本杆是否有“己方合法进球”
  const mineG = m.groups[p];
  const legalPot = !fouls.length && effPocketed.some((b) => mineG && groupOf(b) === mineG);
  const openPot = !fouls.length && prev.groups[p] === null && effPocketed.length > 0;

  m.breakShot = false;
  if (m.phase === 'break') m.phase = m.groups[p] ? 'play' : 'open';

  if (fouls.length) {
    m.turn = opp;
    m.ballInHand = true;
    m.combo = 0;
    events.push({ type: 'foul', player: p, reasons: fouls });
  } else if (legalPot || openPot) {
    m.combo = prev.combo + 1;
    events.push({ type: 'continue', player: p, combo: m.combo });
  } else {
    m.turn = opp;
    m.ballInHand = false;
    m.combo = 0;
    events.push({ type: 'switch', player: opp });
  }
  if (fouls.length === 0 && m.turn !== p) m.ballInHand = false;
  m.log.push({ player: p, pocketed: [...rep.pocketed], fouls });
  return { match: m, fouls, events };
}

// 练习模式：不判规则，只统计进球与连击
export function resolvePractice(prev, rep) {
  const m = { ...prev, scores: [...prev.scores], onTable: new Set(prev.onTable) };
  const events = [];
  const objs = rep.pocketed.filter((b) => b !== 0);
  for (const b of objs) {
    m.onTable.delete(b);
    m.scores[0] += 1;
    events.push({ type: 'pocket', ball: b, player: 0 });
  }
  if (objs.length) m.combo = prev.combo + 1; else m.combo = 0;
  if (rep.pocketed.includes(0)) events.push({ type: 'foul', player: 0, reasons: ['scratch'] });
  return { match: m, fouls: rep.pocketed.includes(0) ? ['scratch'] : [], events };
}
