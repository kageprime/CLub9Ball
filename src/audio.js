// 音频：Web Audio。
//  • 台球采样（Freesound 社区 CC0，放在 assets/audio/，由 manifest.json 描述，支持“切片”：一个长文件切出多个变体随机播放）
//  • 采样缺失时用合成音兜底（保证没有素材也有声音）
//  • 程序化房间混响：噪声指数衰减生成脉冲响应（确定性 PRNG）→ ConvolverNode
//  • 总线末端压限器（DynamicsCompressor），防止连环碰撞爆音
//  • BGM：assets/audio/bgm.* （用户提供的 lounge jazz 循环）；缺失时用简易程序化爵士和弦垫；M 静音

import { mulberry32 } from './rng.js';

const KINDS = ['hit', 'cushion', 'pocket', 'break', 'cue', 'place', 'cheer'];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.samples = {};            // kind → [{buffer, offset, dur}]
    this.status = {};             // 供“关于”面板显示：kind → 'loaded' | 'fallback'
    this.bgmEl = null;
    this.bgmMode = 'none';        // 'file' | 'procedural' | 'none'
    this._procTimer = null;
    this.rng = mulberry32(2718);
  }

  // 必须在用户手势里调用
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.master.connect(this.limiter).connect(c.destination);

    this.dry = c.createGain(); this.dry.gain.value = 1; this.dry.connect(this.master);
    this.verb = c.createConvolver();
    this.verb.buffer = this._makeIR(1.7, 3.2);
    this.wet = c.createGain(); this.wet.gain.value = 0.28;
    this.verb.connect(this.wet).connect(this.master);
    this.send = c.createGain(); this.send.gain.value = 1; this.send.connect(this.verb);

    this.bgmGain = c.createGain(); this.bgmGain.gain.value = 0.35;
    this.bgmGain.connect(this.master);
    this.bgmGain.connect(this.send);
  }

  // 房间脉冲响应：双声道噪声 × 指数衰减，并随时间逐步低通（高频先消失）
  _makeIR(seconds, decay) {
    const c = this.ctx, rate = c.sampleRate, len = Math.floor(seconds * rate);
    const ir = c.createBuffer(2, len, rate);
    const rng = mulberry32(31415);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const env = Math.exp(-t * decay);
        const k = 0.15 + 0.85 * Math.exp(-t * 2.2);       // 低通系数：越往后越闷
        lp += k * ((rng() * 2 - 1) - lp);
        d[i] = lp * env * (i < 80 ? i / 80 : 1);
      }
    }
    return ir;
  }

  // ---------- 素材 ----------
  async loadManifest(base = 'assets/audio/') {
    for (const k of KINDS) this.status[k] = 'fallback';
    this.status.bgm = 'fallback';
    let manifest = null;
    try {
      const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (r.ok) manifest = await r.json();
    } catch (_) { /* 没有清单：全部兜底 */ }
    if (!manifest) return this.status;
    const decoded = new Map();
    const getBuf = async (file) => {
      if (decoded.has(file)) return decoded.get(file);
      const p = (async () => {
        try {
          const r = await fetch(base + file);
          if (!r.ok) return null;
          return await this.ctx.decodeAudioData(await r.arrayBuffer());
        } catch (_) { return null; }
      })();
      decoded.set(file, p);
      return p;
    };
    for (const k of KINDS) {
      const list = manifest[k];
      if (!Array.isArray(list)) continue;
      const out = [];
      for (const e of list) {
        const spec = typeof e === 'string' ? { file: e } : e;
        const buf = await getBuf(spec.file);
        if (!buf) continue;
        out.push({ buffer: buf, offset: spec.start || 0, dur: spec.dur || (buf.duration - (spec.start || 0)), gain: spec.gain ?? 1 });
      }
      if (out.length) { this.samples[k] = out; this.status[k] = 'loaded'; }
    }
    if (manifest.bgm) this.bgmFile = base + manifest.bgm;
    return this.status;
  }

  // ---------- 播放 ----------
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.03);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
  }

  _out(pan = 0, wet = 0.5) {
    const c = this.ctx;
    const g = c.createGain();
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(this.dry); }
    else g.connect(this.dry);
    const s = c.createGain(); s.gain.value = wet;
    (p || g).connect(s); s.connect(this.send);
    return g;
  }

  _sample(kind, { gain = 1, rate = 1, pan = 0 } = {}) {
    const list = this.samples[kind];
    if (!list || !list.length) return false;
    const e = list[Math.floor(Math.random() * list.length)];
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = e.buffer;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = this._out(pan);
    g.gain.value = gain * e.gain;
    src.connect(g);
    src.start(0, e.offset, e.dur);
    return true;
  }

  // 噪声缓冲（合成音共用）
  _noise(dur) {
    const c = this.ctx, len = Math.floor(dur * c.sampleRate);
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _burst({ dur = 0.05, freq = 3000, q = 1.5, type = 'bandpass', gain = 0.5, pan = 0, wet = 0.5, attack = 0.001 }) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this._noise(dur);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this._out(pan, wet);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    src.start(t);
  }

  _tone({ freq = 800, dur = 0.08, type = 'sine', gain = 0.3, pan = 0, wet = 0.5, slide = 0 }) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = this._out(pan, wet);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.02);
  }

  // kind：hit cushion pocket break cue place cheer dart thud rattle click bang foul ui
  play(kind, { speed = 2, pan = 0, gain = 1 } = {}) {
    if (!this.ctx || this.muted) return;
    const k = Math.min(1, speed / 5);
    const loud = Math.pow(k, 0.8);
    const rate = 0.94 + Math.random() * 0.12;
    switch (kind) {
      case 'hit':
        if (this._sample('hit', { gain: (0.25 + loud) * gain, rate, pan })) return;
        this._burst({ dur: 0.045, freq: 3200 * rate, q: 2.2, gain: (0.12 + loud * 0.7) * gain, pan });
        this._tone({ freq: 2100 * rate, dur: 0.06, gain: (0.04 + loud * 0.22) * gain, pan, slide: 0.8 });
        break;
      case 'cushion':
        if (this._sample('cushion', { gain: (0.25 + loud) * gain, rate, pan })) return;
        this._burst({ dur: 0.09, freq: 420 * rate, q: 0.8, type: 'lowpass', gain: (0.15 + loud * 0.6) * gain, pan });
        this._tone({ freq: 160 * rate, dur: 0.1, gain: (0.08 + loud * 0.3) * gain, pan, slide: 0.6 });
        break;
      case 'pocket':
        if (this._sample('pocket', { gain: (0.5 + loud * 0.5) * gain, rate, pan })) return;
        this._tone({ freq: 140, dur: 0.18, gain: 0.35 * gain, pan, slide: 0.5 });
        for (let i = 0; i < 4; i++) setTimeout(() => this._burst({ dur: 0.04, freq: 1400 + i * 300, q: 3, gain: 0.18 * gain, pan }), 60 + i * 55);
        break;
      case 'break':
        if (this._sample('break', { gain: 1 * gain, rate, pan })) return;
        this._burst({ dur: 0.12, freq: 2200, q: 1.2, gain: 0.9 * gain });
        this._tone({ freq: 90, dur: 0.22, gain: 0.5 * gain, slide: 0.5 });
        break;
      case 'cue':
        if (this._sample('cue', { gain: (0.4 + loud * 0.6) * gain, rate, pan })) return;
        this._burst({ dur: 0.03, freq: 4200, q: 3, gain: (0.2 + loud * 0.5) * gain, pan });
        this._tone({ freq: 220, dur: 0.07, gain: (0.1 + loud * 0.3) * gain, slide: 0.7 });
        break;
      case 'place':
        if (this._sample('place', { gain: 0.8 * gain, rate, pan })) return;
        this._burst({ dur: 0.05, freq: 1800, q: 2, gain: 0.3 * gain, pan });
        break;
      case 'cheer':
        if (this._sample('cheer', { gain: 0.9 * gain })) return;
        this._burst({ dur: 1.4, freq: 900, q: 0.4, gain: 0.35 * gain, wet: 0.8, attack: 0.25 });
        this._burst({ dur: 1.2, freq: 1700, q: 0.6, gain: 0.18 * gain, wet: 0.8, attack: 0.3 });
        break;
      case 'dart':
        this._burst({ dur: 0.05, freq: 900, q: 1.5, gain: 0.5 * gain });
        this._tone({ freq: 300, dur: 0.06, gain: 0.3 * gain, type: 'triangle', slide: 0.5 });
        break;
      case 'rattle':
        for (let i = 0; i < 7; i++) setTimeout(() => this._burst({ dur: 0.03, freq: 1800 + Math.random() * 2500, q: 2, gain: (0.12 + Math.random() * 0.22) * gain, pan: (Math.random() - 0.5) * 0.6 }), i * 55 + Math.random() * 25);
        break;
      case 'thud':
        this._burst({ dur: 0.07, freq: 500, q: 0.8, type: 'lowpass', gain: 0.5 * gain });
        break;
      case 'click':
        this._burst({ dur: 0.02, freq: 3000, q: 4, gain: 0.5 * gain });
        this._tone({ freq: 1200, dur: 0.03, type: 'square', gain: 0.08 * gain });
        break;
      case 'bang':
        this._burst({ dur: 0.35, freq: 1200, q: 0.3, type: 'lowpass', gain: 1.0 * gain, wet: 0.9 });
        this._tone({ freq: 110, dur: 0.4, gain: 0.7 * gain, slide: 0.3, wet: 0.9 });
        break;
      case 'foul':
        this._tone({ freq: 160, dur: 0.22, type: 'sawtooth', gain: 0.18 * gain, slide: 0.7 });
        break;
      case 'ui':
        this._tone({ freq: 880, dur: 0.06, type: 'square', gain: 0.07 * gain });
        break;
      case 'achieve':
        [660, 880, 1320].forEach((f, i) => setTimeout(() => this._tone({ freq: f, dur: 0.14, type: 'square', gain: 0.09 * gain }), i * 90));
        break;
      default: break;
    }
  }

  // ---------- BGM ----------
  async startBGM(files = ['assets/audio/bgm.mp3', 'assets/audio/bgm.ogg', 'assets/audio/bgm.m4a']) {
    if (!this.ctx || this.bgmMode !== 'none') return;
    const candidates = this.bgmFile ? [this.bgmFile, ...files] : files;
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: 'HEAD' });
        if (!r.ok) continue;
        const el = new Audio(url);
        el.loop = true; el.crossOrigin = 'anonymous';
        const src = this.ctx.createMediaElementSource(el);
        src.connect(this.bgmGain);
        await el.play();
        this.bgmEl = el; this.bgmMode = 'file'; this.status.bgm = 'loaded';
        return;
      } catch (_) { /* 试下一个 */ }
    }
    this._startProceduralBGM();
  }

  // 程序化 lounge：Dm9 – G13 – Cmaj9 – A7♭9，慢摇摆，电钢琴音色（正弦 + 三角 + 轻微失谐）+ 刷子底噪
  _startProceduralBGM() {
    this.bgmMode = 'procedural';
    const c = this.ctx;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const chords = [
      [50, 57, 60, 64, 65], // Dm9
      [43, 53, 57, 59, 64], // G13
      [48, 55, 59, 62, 64], // Cmaj9
      [45, 55, 58, 61, 63], // A7b9
    ];
    const bpm = 68, beat = 60 / bpm;
    let next = c.currentTime + 0.1, bar = 0;
    const schedule = () => {
      while (next < c.currentTime + 1.2) {
        const chord = chords[bar % 4];
        for (const [i, n] of chord.entries()) {
          const t = next + i * 0.018;
          for (const [type, det, gl] of [['sine', 0, 0.05], ['triangle', 4, 0.025]]) {
            const o = c.createOscillator(); o.type = type; o.frequency.value = midi(n); o.detune.value = det;
            const g = c.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(gl, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 3.6);
            o.connect(g).connect(this.bgmGain);
            o.start(t); o.stop(t + beat * 3.7);
          }
        }
        // 低音：每小节第 1、3 拍
        for (const b of [0, 2]) {
          const t = next + b * beat;
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = midi(chord[0] - 12);
          const g = c.createGain();
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.6);
          o.connect(g).connect(this.bgmGain); o.start(t); o.stop(t + beat * 1.7);
        }
        // 刷子：摇摆 8 分音符（长-短）
        for (let b = 0; b < 4; b++) {
          for (const sw of [0, 0.66]) {
            const t = next + (b + sw) * beat;
            const src = c.createBufferSource(); src.buffer = this._noise(0.08);
            const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5200;
            const g = c.createGain();
            g.gain.setValueAtTime(sw ? 0.012 : 0.022, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
            src.connect(f).connect(g).connect(this.bgmGain); src.start(t);
          }
        }
        next += 4 * beat; bar++;
      }
    };
    schedule();
    this._procTimer = setInterval(schedule, 400);
  }

  stopBGM() {
    if (this.bgmEl) { this.bgmEl.pause(); this.bgmEl = null; }
    if (this._procTimer) { clearInterval(this._procTimer); this._procTimer = null; }
    this.bgmMode = 'none';
  }
}
