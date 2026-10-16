// 每杆回放：录制 60 Hz 快照 + 事件（供回放时重放音效）。纯数据，不依赖 DOM / Rapier。
// 回放只读快照，不触碰物理世界。

import { SNAP_STRIDE } from './sim.js';

export const FRAME_FLOATS = 16 * SNAP_STRIDE;
export const SAMPLE_DT = 1 / 60;

export class ReplayRecorder {
  constructor() { this.reset(); }
  reset() {
    this.chunks = [];
    this.count = 0;
    this.cap = 0;
    this.buf = null;
    this.events = [];
    this.active = false;
    this.meta = null;
  }
  begin(snapshot, meta = {}) {
    this.reset();
    this.active = true;
    this.meta = meta;
    this._grow(256);
    this.push(snapshot);
  }
  _grow(frames) {
    const nb = new Float32Array(frames * FRAME_FLOATS);
    if (this.buf) nb.set(this.buf.subarray(0, this.count * FRAME_FLOATS));
    this.buf = nb; this.cap = frames;
  }
  push(snapshot) {
    if (!this.active) return;
    if (this.count >= this.cap) this._grow(this.cap * 2);
    this.buf.set(snapshot, this.count * FRAME_FLOATS);
    this.count++;
  }
  addEvent(ev) {
    if (!this.active) return;
    this.events.push({ ...ev, ft: Math.max(0, this.count - 1) * SAMPLE_DT });
  }
  // 结束录制，返回一杆回放数据（拷贝，避免后续复用缓冲区）
  finish() {
    if (!this.active) return null;
    this.active = false;
    const frames = this.buf.slice(0, this.count * FRAME_FLOATS);
    return { frames, count: this.count, duration: Math.max(SAMPLE_DT, (this.count - 1) * SAMPLE_DT), events: this.events.slice(), meta: this.meta };
  }
}

export class ReplayPlayer {
  constructor(shot) {
    this.shot = shot;
    this.time = 0;
    this.speed = 1;
    this.playing = true;
    this.finished = false;
    this._evIdx = 0;
    this._out = new Float32Array(FRAME_FLOATS);
  }
  get duration() { return this.shot.duration; }
  get progress() { return this.shot.duration > 0 ? this.time / this.shot.duration : 0; }

  setSpeed(s) { this.speed = Math.max(0.1, Math.min(1, s)); }

  seek(frac) {
    this.time = Math.max(0, Math.min(1, frac)) * this.shot.duration;
    // 重新定位事件游标（拖动后只触发之后的事件）
    this._evIdx = this.shot.events.findIndex((e) => e.ft >= this.time);
    if (this._evIdx < 0) this._evIdx = this.shot.events.length;
    this.finished = false;
  }

  // 推进 dtReal 秒，返回这段时间内应触发的事件
  update(dtReal) {
    const fired = [];
    if (!this.playing) return fired;
    const prev = this.time;
    this.time = Math.min(this.shot.duration, this.time + dtReal * this.speed);
    while (this._evIdx < this.shot.events.length && this.shot.events[this._evIdx].ft <= this.time) {
      if (this.shot.events[this._evIdx].ft >= prev - 1e-9) fired.push(this.shot.events[this._evIdx]);
      this._evIdx++;
    }
    if (this.time >= this.shot.duration) { this.finished = true; this.playing = false; }
    return fired;
  }

  // 取当前时刻插值后的快照（位置线性插值，四元数 nlerp）
  frame() {
    const { frames, count } = this.shot;
    const f = this.time / SAMPLE_DT;
    const i0 = Math.min(count - 1, Math.floor(f));
    const i1 = Math.min(count - 1, i0 + 1);
    const a = Math.min(1, f - i0);
    const o = this._out;
    for (let n = 0; n < 16; n++) {
      const k = n * SNAP_STRIDE;
      const b0 = i0 * FRAME_FLOATS + k, b1 = i1 * FRAME_FLOATS + k;
      const p0 = frames[b0] < 0, p1 = frames[b1] < 0;
      if (p0 || p1) {
        // 任一帧已落袋 → 按后帧（落袋后的位置/标记）输出，避免球在袋口“闪回”
        const src = p1 ? b1 : b0;
        for (let j = 0; j < SNAP_STRIDE; j++) o[k + j] = frames[src + j];
        continue;
      }
      o[k] = frames[b0];
      for (let j = 1; j <= 3; j++) o[k + j] = frames[b0 + j] + (frames[b1 + j] - frames[b0 + j]) * a;
      // 四元数：保证同半球再 nlerp
      let dot = 0;
      for (let j = 4; j <= 7; j++) dot += frames[b0 + j] * frames[b1 + j];
      const s = dot < 0 ? -1 : 1;
      let len = 0;
      for (let j = 4; j <= 7; j++) { o[k + j] = frames[b0 + j] * (1 - a) + frames[b1 + j] * s * a; len += o[k + j] * o[k + j]; }
      len = Math.sqrt(len) || 1;
      for (let j = 4; j <= 7; j++) o[k + j] /= len;
    }
    return o;
  }
}
