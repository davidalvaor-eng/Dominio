export type SfxName =
  | "select"
  | "send"
  | "capture"
  | "lost"
  | "boom"
  | "shot"
  | "buy"
  | "plane"
  | "win"
  | "lose"
  | "click"
  | "error"
  | "start"
  | "streak"
  | "alert";

const VOL = 0.42;

/** Tiny WebAudio synth: zero assets, instant feedback. */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last: Partial<Record<SfxName, number>> = {};
  muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = localStorage.getItem("dominio.muted") === "1";
      } catch {
        /* ignore */
      }
    }
  }

  unlock() {
    if (typeof window === "undefined") return;
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : VOL;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem("dominio.muted", m ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : VOL, this.ctx.currentTime, 0.02);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slide = 0) {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private noise(dur: number, vol: number, f0: number, f1: number, delay = 0, type: BiquadFilterType = "lowpass") {
    const c = this.ctx;
    if (!c || !this.master || !this.noiseBuf) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.05);
  }

  play(name: SfxName) {
    if (!this.ctx || this.muted || this.ctx.state !== "running") return;
    const now = performance.now();
    const gap = name === "shot" ? 75 : name === "boom" ? 110 : 45;
    if (now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    switch (name) {
      case "select":
        this.tone(880, 0.07, "triangle", 0.12);
        this.tone(1320, 0.05, "sine", 0.06, 0.03);
        break;
      case "click":
        this.tone(620, 0.04, "square", 0.05);
        break;
      case "send":
        this.noise(0.22, 0.12, 2400, 500, 0, "bandpass");
        this.tone(330, 0.12, "triangle", 0.09, 0, 520);
        break;
      case "capture":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.16, "square", 0.065, i * 0.06));
        this.noise(0.35, 0.07, 5000, 900, 0, "highpass");
        break;
      case "streak":
        [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.08, i * 0.05));
        break;
      case "lost":
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.22, "sawtooth", 0.07, i * 0.09));
        break;
      case "boom":
        this.noise(0.7, 0.5, 1300, 60);
        this.tone(95, 0.5, "sine", 0.32, 0, 30);
        break;
      case "shot":
        this.noise(0.05, 0.05, 5200, 1600, 0, "highpass");
        break;
      case "buy":
        this.tone(988, 0.06, "square", 0.06);
        this.tone(1480, 0.1, "square", 0.06, 0.06);
        break;
      case "plane":
        this.noise(1.1, 0.09, 300, 2200, 0, "bandpass");
        this.tone(180, 0.9, "sawtooth", 0.022, 0, 110);
        break;
      case "win":
        [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          this.tone(f, i === 6 ? 0.6 : 0.16, "square", 0.07, i * 0.12),
        );
        break;
      case "lose":
        [440, 415.3, 392, 349.2].forEach((f, i) => this.tone(f, 0.35, "sawtooth", 0.06, i * 0.22));
        break;
      case "error":
        this.tone(170, 0.12, "square", 0.06);
        break;
      case "start":
        this.tone(440, 0.1, "square", 0.06);
        this.tone(660, 0.1, "square", 0.06, 0.08);
        this.tone(880, 0.22, "square", 0.07, 0.16);
        break;
      case "alert":
        this.tone(880, 0.1, "square", 0.05);
        this.tone(660, 0.12, "square", 0.05, 0.12);
        break;
    }
  }
}

export const sfx = new Sfx();
