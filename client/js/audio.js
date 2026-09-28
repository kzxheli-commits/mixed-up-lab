// 程序化音效（WebAudio 合成，零外部资源）—— 卡通夸张风格（设计书 §28）
class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  // 浏览器要求用户手势后才能出声：在第一次点击/按键时调用
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _tone(type, f0, f1, dur, delay = 0, vol = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  _noise(dur, vol = 0.5, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'jump': this._tone('square', 300, 560, 0.12, 0, 0.5); break;
      case 'grab': this._tone('triangle', 240, 170, 0.1, 0, 0.7); break;
      case 'throw': this._noise(0.16, 0.4); this._tone('triangle', 320, 110, 0.16, 0, 0.5); break;
      case 'tag': this._tone('square', 950, 280, 0.15, 0, 0.55); break;          // biu
      case 'scale': this._tone('sine', 480, 920, 0.14, 0, 0.6); break;
      case 'copy': this._tone('triangle', 660, null, 0.07, 0, 0.55); this._tone('triangle', 880, null, 0.09, 0.08, 0.55); break;
      case 'morph': this._tone('square', 320, 70, 0.3, 0, 0.55); break;
      case 'unmorph': this._tone('square', 70, 320, 0.3, 0, 0.55); break;
      case 'slip': this._tone('sawtooth', 720, 170, 0.32, 0, 0.55); this._noise(0.2, 0.25); break;
      case 'cluck': this._tone('square', 820, 760, 0.06, 0, 0.5); this._tone('square', 640, 580, 0.07, 0.08, 0.5); break;
      case 'peck': this._tone('square', 900, 700, 0.05, 0, 0.4); break;
      case 'boing': this._tone('sine', 200, 780, 0.1, 0, 0.6); this._tone('sine', 780, 220, 0.28, 0.1, 0.5); break;
      case 'boom': this._noise(0.5, 0.7); this._tone('sine', 130, 38, 0.45, 0, 0.8); break;
      case 'door': this._tone('triangle', 190, 520, 0.4, 0, 0.55); this._tone('triangle', 380, 760, 0.3, 0.15, 0.35); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this._tone('triangle', f, null, 0.16, i * 0.11, 0.6)); break;
      case 'alarm': this._tone('sawtooth', 780, 420, 0.2, 0, 0.4); this._tone('sawtooth', 780, 420, 0.2, 0.24, 0.4); break;
      case 'error': this._tone('square', 210, 150, 0.13, 0, 0.5); break;
      case 'ui': this._tone('triangle', 660, null, 0.05, 0, 0.4); break;
      default: break;
    }
  }
}

export const sfx = new Sfx();
