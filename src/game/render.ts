import type { GameMap, GameState } from "./types";
import { armyPower, cityPower, isAlly } from "./sim";
import { COL_NEUTRAL, REL_COL, STRIKE_RADIUS } from "./constants";

const TAU = Math.PI * 2;
const PAD = 220;
export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface Camera {
  x: number;
  y: number;
  z: number;
  rot: boolean;
}

export interface Preview {
  path: number[];
  ok: number; // 0 = friendly move, 1 = favourable, 2 = unfavourable
  send: number;
  def: number;
}

export interface View {
  state: GameState;
  me: number;
  colors: string[];
  sources: number[];
  selArmy: string | null;
  inspect: number;
  hoverCity: number;
  target: number;
  drag: { x: number; y: number } | null;
  preview: Preview | null;
  strikeMode: boolean;
  hint: { from: number; to: number } | null;
  smooth: boolean;
  spectator: boolean;
}

interface Part {
  on: boolean;
  k: number; // 0 spark, 1 smoke, 2 ring, 3 glow, 4 debris, 5 ember
  ax: number;
  ay: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  col: string;
  drag: number;
}

interface FText {
  ax: number;
  ay: number;
  text: string;
  col: string;
  life: number;
  max: number;
  size: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const tintCache = new Map<string, string>();
export function tint(hex: string, a: number): string {
  const key = hex + "|" + a;
  let v = tintCache.get(key);
  if (v) return v;
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  tintCache.set(key, v);
  return v;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  W = 1;
  H = 1;
  dpr = 1;
  vcx = 0;
  vcy = 0;
  availH = 1;
  insetTop = 68;
  insetBottom = 96;
  cam: Camera = { x: 800, y: 500, z: 0.8, rot: false };
  goal: { x: number; y: number; z: number } | null = null;
  fitZ = 0.8;
  zMin = 0.3;
  zMax = 3;
  map: GameMap | null = null;
  px = 0;
  py = 0;
  ox = 0;
  oy = 0;
  k = 1;
  time = 0;
  trauma = 0;
  reduceMotion = false;
  coarse = false;
  private bg: HTMLCanvasElement | null = null;
  private bgScale = 0;
  private bgFor: GameMap | null = null;
  private bgWant = 0;
  private bgWait = 0;
  private vignette: HTMLCanvasElement | null = null;
  private glows = new Map<string, HTMLCanvasElement>();
  private parts: Part[] = [];
  private pi = 0;
  private texts: FText[] = [];
  private flashA = 0;
  private flashCol = "#ffffff";
  private vis = new Map<string, { x: number; y: number }>();
  private pulses = new Map<number, { t: number; s: number }>();
  private seen = new Set<string>();
  private besieged = new Set<number>();
  private threatened = new Set<number>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D no disponible");
    this.ctx = ctx;
    for (let i = 0; i < 720; i++) {
      this.parts.push({ on: false, k: 0, ax: 0, ay: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s0: 1, s1: 1, col: "#ffffff", drag: 0 });
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      this.coarse = window.matchMedia("(pointer: coarse)").matches;
      this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  }

  // ------------------------------------------------------------ camera

  resize(w: number, h: number) {
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    this.dpr = dpr;
    this.W = w;
    this.H = h;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.insetTop = w < 640 ? 60 : 68;
    this.insetBottom = w < 640 ? 118 : 96;
    this.availH = Math.max(120, h - this.insetTop - this.insetBottom);
    this.vcx = w / 2;
    this.vcy = this.insetTop + this.availH / 2;
    this.buildVignette();
    if (this.map) {
      const before = this.fitZ;
      this.computeFit(this.map);
      this.cam.z = clamp(this.cam.z * (this.fitZ / before), this.zMin, this.zMax);
      this.goal = null;
      this.clampCam();
    }
  }

  computeFit(map: GameMap) {
    const rot = this.H > this.W * 1.15;
    this.cam.rot = rot;
    const mw = map.w + 80;
    const mh = map.h + 80;
    const z = rot ? Math.min(this.availH / mw, this.W / mh) : Math.min(this.W / mw, this.availH / mh);
    this.fitZ = z;
    this.zMin = z * 0.9;
    this.zMax = Math.max(2.2, z * 5);
  }

  setMap(map: GameMap) {
    this.map = map;
    this.computeFit(map);
    this.vis.clear();
    this.pulses.clear();
    for (const p of this.parts) p.on = false;
    this.texts.length = 0;
  }

  fitNow() {
    if (!this.map) return;
    this.computeFit(this.map);
    this.cam.x = this.map.w / 2;
    this.cam.y = this.map.h / 2;
    this.cam.z = this.fitZ;
    this.goal = null;
  }

  focus(x: number, y: number, z: number) {
    const zz = clamp(z, this.zMin, this.zMax);
    const c = this.clampPos(x, y, zz);
    this.goal = { x: c.x, y: c.y, z: zz };
  }

  private clampPos(x: number, y: number, z: number) {
    const m = this.map;
    if (!m) return { x, y };
    const rot = this.cam.rot;
    const viewW = (rot ? this.availH : this.W) / z;
    const viewH = (rot ? this.W : this.availH) / z;
    const mg = 70;
    return {
      x: viewW >= m.w + mg * 2 ? m.w / 2 : clamp(x, viewW / 2 - mg, m.w - viewW / 2 + mg),
      y: viewH >= m.h + mg * 2 ? m.h / 2 : clamp(y, viewH / 2 - mg, m.h - viewH / 2 + mg),
    };
  }

  clampCam() {
    const c = this.clampPos(this.cam.x, this.cam.y, this.cam.z);
    this.cam.x = c.x;
    this.cam.y = c.y;
  }

  w2s(x: number, y: number) {
    const c = this.cam;
    if (c.rot) {
      this.px = this.vcx - (y - c.y) * c.z + this.ox;
      this.py = this.vcy + (x - c.x) * c.z + this.oy;
    } else {
      this.px = this.vcx + (x - c.x) * c.z + this.ox;
      this.py = this.vcy + (y - c.y) * c.z + this.oy;
    }
  }

  s2w(sx: number, sy: number): { x: number; y: number } {
    const c = this.cam;
    if (c.rot) return { x: c.x + (sy - this.vcy) / c.z, y: c.y - (sx - this.vcx) / c.z };
    return { x: c.x + (sx - this.vcx) / c.z, y: c.y + (sy - this.vcy) / c.z };
  }

  private worldTransform() {
    const c = this.cam;
    const d = this.dpr;
    const z = c.z;
    if (c.rot) this.ctx.setTransform(0, z * d, -z * d, 0, (this.vcx + c.y * z + this.ox) * d, (this.vcy - c.x * z + this.oy) * d);
    else this.ctx.setTransform(z * d, 0, 0, z * d, (this.vcx - c.x * z + this.ox) * d, (this.vcy - c.y * z + this.oy) * d);
  }

  panBy(dx: number, dy: number) {
    const c = this.cam;
    if (c.rot) {
      c.x -= dy / c.z;
      c.y += dx / c.z;
    } else {
      c.x -= dx / c.z;
      c.y -= dy / c.z;
    }
    this.goal = null;
    this.clampCam();
  }

  zoomAt(sx: number, sy: number, f: number) {
    const before = this.s2w(sx, sy);
    this.cam.z = clamp(this.cam.z * f, this.zMin, this.zMax);
    const after = this.s2w(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.goal = null;
    this.clampCam();
  }

  cityR(level: number) {
    return (level === 3 ? 19 : level === 2 ? 15.5 : 12.5) * this.k;
  }

  armyScreen(id: string): { x: number; y: number } | null {
    const p = this.vis.get(id);
    if (!p) return null;
    this.w2s(p.x, p.y);
    return { x: this.px, y: this.py };
  }

  onScreen(x: number, y: number, m = 40) {
    this.w2s(x, y);
    return this.px > -m && this.py > -m && this.px < this.W + m && this.py < this.H + m;
  }

  // ------------------------------------------------------------ effects

  private spawn(k: number, ax: number, ay: number, x: number, y: number, vx: number, vy: number, max: number, s0: number, s1: number, col: string, drag: number) {
    const p = this.parts[this.pi];
    this.pi = (this.pi + 1) % this.parts.length;
    p.on = true;
    p.k = k;
    p.ax = ax;
    p.ay = ay;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = 0;
    p.max = max;
    p.s0 = s0;
    p.s1 = s1;
    p.col = col;
    p.drag = drag;
  }

  burst(ax: number, ay: number, col: string, n: number, spd: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = spd * (0.35 + Math.random() * 0.65);
      this.spawn(0, ax, ay, 0, 0, Math.cos(a) * v, Math.sin(a) * v, 0.35 + Math.random() * 0.45, 2.2, 0, col, 3.2);
    }
  }

  sparks(ax: number, ay: number, col: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = 60 + Math.random() * 120;
      this.spawn(0, ax, ay, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, Math.cos(a) * v, Math.sin(a) * v, 0.2 + Math.random() * 0.25, 1.7, 0, Math.random() < 0.5 ? col : "#ffe8a3", 4);
    }
  }

  muzzle(ax: number, ay: number, spread: number) {
    this.spawn(3, ax, ay, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, 0, 0, 0.12, 6, 11, "#ffd27a", 0);
  }

  smoke(ax: number, ay: number, n: number, size: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = 8 + Math.random() * 22;
      this.spawn(1, ax, ay, Math.cos(a) * 4, Math.sin(a) * 4, Math.cos(a) * v, Math.sin(a) * v - 6, 0.9 + Math.random() * 0.8, size * 0.5, size * (1.3 + Math.random()), Math.random() < 0.5 ? "#5b6b7d" : "#3b4757", 1.2);
    }
  }

  ring(ax: number, ay: number, col: string, r0: number, r1: number, dur: number) {
    this.spawn(2, ax, ay, 0, 0, 0, 0, dur, r0, r1, col, 0);
  }

  glowFlash(ax: number, ay: number, col: string, s0: number, s1: number, dur: number) {
    this.spawn(3, ax, ay, 0, 0, 0, 0, dur, s0, s1, col, 0);
  }

  puff(ax: number, ay: number, col: string) {
    this.ring(ax, ay, col, 4, 24, 0.35);
    this.smoke(ax, ay, 3, 6);
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * TAU;
      this.spawn(5, ax, ay, 0, 0, Math.cos(a) * 55, Math.sin(a) * 55, 0.35, 2.6, 0, col, 4);
    }
  }

  explode(ax: number, ay: number, size: number) {
    this.glowFlash(ax, ay, "#ffb347", 10 * size, 36 * size, 0.35);
    this.glowFlash(ax, ay, "#fff4d6", 6 * size, 16 * size, 0.18);
    this.burst(ax, ay, "#ffb347", Math.round(14 * size), 170 * size);
    this.burst(ax, ay, "#ff6a3d", Math.round(8 * size), 110 * size);
    this.smoke(ax, ay, Math.round(5 * size), 9 * size);
    this.ring(ax, ay, "#ffd9a0", 4, 30 * size, 0.4);
    for (let i = 0; i < 6 * size; i++) {
      const a = Math.random() * TAU;
      const v = 60 + Math.random() * 120;
      this.spawn(4, ax, ay, 0, 0, Math.cos(a) * v, Math.sin(a) * v, 0.5 + Math.random() * 0.4, 2.4, 0, "#1e293b", 2.5);
    }
  }

  bigBoom(ax: number, ay: number) {
    this.glowFlash(ax, ay, "#fff7e0", 20, 95, 0.4);
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU;
      const d = Math.random() * 34;
      this.explode(ax + Math.cos(a) * d, ay + Math.sin(a) * d, 1.1 + Math.random() * 0.5);
    }
    this.ring(ax, ay, "#ffffff", 10, 95, 0.55);
    this.ring(ax, ay, "#ff9f43", 6, 70, 0.75);
    this.smoke(ax, ay, 10, 16);
  }

  confetti(ax: number, ay: number) {
    const cols = ["#38bdf8", "#34d399", "#facc15", "#f472b6", "#ffffff", "#fb923c"];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU;
      const v = 80 + Math.random() * 220;
      this.spawn(4, ax, ay, 0, 0, Math.cos(a) * v, Math.sin(a) * v, 1 + Math.random() * 0.8, 3 + Math.random() * 2, 0, cols[i % cols.length], 1.8);
    }
    this.ring(ax, ay, "#ffffff", 6, 80, 0.6);
  }

  text(ax: number, ay: number, text: string, col: string, size: number, dur = 1.1) {
    this.texts.push({ ax, ay, text, col, life: 0, max: dur, size });
    if (this.texts.length > 30) this.texts.shift();
  }

  cityPulse(i: number, s = 1) {
    this.pulses.set(i, { t: this.time, s });
  }

  addShake(a: number) {
    this.trauma = Math.min(1, this.trauma + (this.reduceMotion ? a * 0.25 : a));
  }

  flash(col: string, a: number) {
    this.flashCol = col;
    this.flashA = Math.max(this.flashA, this.reduceMotion ? a * 0.4 : a);
  }

  update(dt: number) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
    for (const p of this.parts) {
      if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.on = false;
        continue;
      }
      if (p.drag) {
        const dr = Math.exp(-p.drag * dt);
        p.vx *= dr;
        p.vy *= dr;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += dt;
      if (t.life >= t.max) this.texts.splice(i, 1);
    }
    if (this.goal) {
      const f = 1 - Math.exp(-dt * 5);
      const c = this.cam;
      c.x += (this.goal.x - c.x) * f;
      c.y += (this.goal.y - c.y) * f;
      c.z += (this.goal.z - c.z) * f;
      if (Math.abs(this.goal.z - c.z) < 0.002 && Math.abs(this.goal.x - c.x) < 0.5 && Math.abs(this.goal.y - c.y) < 0.5) this.goal = null;
    }
  }

  // ------------------------------------------------------------ caches

  glow(col: string): HTMLCanvasElement {
    let c = this.glows.get(col);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, tint(col, 0.95));
      grd.addColorStop(0.3, tint(col, 0.4));
      grd.addColorStop(1, tint(col, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    this.glows.set(col, c);
    return c;
  }

  private buildVignette() {
    if (typeof document === "undefined") return;
    const c = this.vignette ?? document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    if (!g) return;
    const grd = g.createRadialGradient(128, 128, 64, 128, 128, 184);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(0,4,10,0.62)");
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    this.vignette = c;
  }

  private pickScale(): number {
    const t = this.cam.z * this.dpr;
    const maxS = this.coarse ? 1.3 : 1.7;
    for (const l of [0.5, 0.75, 1, 1.3, 1.7]) if (l >= t * 0.92) return Math.min(l, maxS);
    return maxS;
  }

  private ensureBg(map: GameMap, dt: number) {
    const want = this.pickScale();
    if (!this.bg || this.bgFor !== map) {
      this.buildBg(map, want);
      return;
    }
    if (want !== this.bgScale) {
      if (want !== this.bgWant) {
        this.bgWant = want;
        this.bgWait = 0.25;
      } else {
        this.bgWait -= dt;
        if (this.bgWait <= 0) this.buildBg(map, want);
      }
    }
  }

  private buildBg(map: GameMap, scale: number) {
    const w = Math.ceil((map.w + PAD * 2) * scale);
    const h = Math.ceil((map.h + PAD * 2) * scale);
    const cv = this.bg ?? document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(scale, 0, 0, scale, PAD * scale, PAD * scale);
    const grd = g.createRadialGradient(map.w / 2, map.h / 2, 60, map.w / 2, map.h / 2, map.w * 0.8);
    grd.addColorStop(0, "#0b2236");
    grd.addColorStop(1, "#040c16");
    g.fillStyle = grd;
    g.fillRect(-PAD, -PAD, map.w + PAD * 2, map.h + PAD * 2);

    g.strokeStyle = "rgba(96,165,250,0.07)";
    g.lineWidth = 1.2;
    g.beginPath();
    for (let x = -200; x <= map.w + 200; x += 100) {
      g.moveTo(x, -PAD);
      g.lineTo(x, map.h + PAD);
    }
    for (let y = -200; y <= map.h + 200; y += 100) {
      g.moveTo(-PAD, y);
      g.lineTo(map.w + PAD, y);
    }
    g.stroke();

    // land: layered unions of circles -> coast glow + topographic levels
    const layers: [number, string][] = [
      [30, "rgba(56,189,248,0.045)"],
      [16, "rgba(56,189,248,0.09)"],
      [7, "#22627f"],
      [0, "#0e2433"],
      [-28, "#112b3e"],
    ];
    for (const [dr, col] of layers) {
      g.fillStyle = col;
      g.beginPath();
      for (const b of map.blobs) {
        const r = b.r + dr;
        if (r <= 2) continue;
        g.moveTo(b.x + r, b.y);
        g.arc(b.x, b.y, r, 0, TAU);
      }
      g.fill();
    }

    g.lineCap = "round";
    for (const r of map.roads) {
      const A = map.cities[r.a];
      const B = map.cities[r.b];
      if (r.sea) {
        g.setLineDash([2, 10]);
        g.strokeStyle = "rgba(125,211,252,0.45)";
        g.lineWidth = 2.6;
        g.beginPath();
        g.moveTo(A.x, A.y);
        g.lineTo(B.x, B.y);
        g.stroke();
        continue;
      }
      g.setLineDash([]);
      g.strokeStyle = "rgba(2,8,16,0.55)";
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(A.x, A.y);
      g.lineTo(B.x, B.y);
      g.stroke();
      g.setLineDash([12, 8]);
      g.strokeStyle = "rgba(160,200,230,0.32)";
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(A.x, A.y);
      g.lineTo(B.x, B.y);
      g.stroke();
    }
    g.setLineDash([]);

    g.strokeStyle = "rgba(125,211,252,0.16)";
    g.lineWidth = 2;
    g.strokeRect(-40, -40, map.w + 80, map.h + 80);
    g.strokeStyle = "rgba(125,211,252,0.5)";
    g.lineWidth = 3;
    const L = 40;
    const corners: [number, number, number, number][] = [
      [-40, -40, 1, 1],
      [map.w + 40, -40, -1, 1],
      [-40, map.h + 40, 1, -1],
      [map.w + 40, map.h + 40, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      g.beginPath();
      g.moveTo(x + sx * L, y);
      g.lineTo(x, y);
      g.lineTo(x, y + sy * L);
      g.stroke();
    }
    g.fillStyle = "rgba(125,211,252,0.35)";
    g.font = "600 14px " + FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let x = 100, i = 0; x < map.w; x += 200, i++) g.fillText(String.fromCharCode(65 + i), x, -58);
    for (let y = 100, i = 1; y < map.h; y += 200, i++) g.fillText(String(i), -58, y);

    this.bg = cv;
    this.bgScale = scale;
    this.bgFor = map;
    this.bgWant = scale;
  }

  // ------------------------------------------------------------ frame

  render(v: View | null, dt: number) {
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#040c16";
    ctx.fillRect(0, 0, this.W, this.H);
    if (!v) return;
    const s = v.state;
    const map = s.map;
    if (this.map !== map) this.setMap(map);
    this.k = clamp(this.cam.z * 1.12, 0.72, 1.5);
    const tr = this.trauma * this.trauma;
    this.ox = tr ? (Math.sin(this.time * 53.1) + Math.sin(this.time * 21.7) * 0.6) * 9 * tr : 0;
    this.oy = tr ? (Math.cos(this.time * 47.3) + Math.sin(this.time * 29.3) * 0.6) * 9 * tr : 0;

    this.ensureBg(map, dt);
    this.updateVis(v, dt);
    this.computeSets(v);

    this.worldTransform();
    if (this.bg) ctx.drawImage(this.bg, -PAD, -PAD, map.w + PAD * 2, map.h + PAD * 2);
    this.drawTerritory(v);
    this.drawRoutes(v);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.drawCities(v);
    this.drawArmies(v);
    this.drawStrikes(v);
    this.drawParts(false);
    ctx.globalCompositeOperation = "lighter";
    this.drawParts(true);
    ctx.globalCompositeOperation = "source-over";
    this.drawTexts();
    this.drawOverlay(v);
    this.drawEdgeAlerts(v);

    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, this.W, this.H);
    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashCol;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }
  }

  private updateVis(v: View, dt: number) {
    const seen = this.seen;
    seen.clear();
    const f = v.smooth ? 1 - Math.exp(-dt * 12) : 1;
    for (const a of v.state.armies) {
      seen.add(a.id);
      const p = this.vis.get(a.id);
      if (!p) {
        this.vis.set(a.id, { x: a.x, y: a.y });
        continue;
      }
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      if (f >= 1 || dx * dx + dy * dy > 40000) {
        p.x = a.x;
        p.y = a.y;
      } else {
        p.x += dx * f;
        p.y += dy * f;
      }
    }
    for (const id of this.vis.keys()) if (!seen.has(id)) this.vis.delete(id);
  }

  private computeSets(v: View) {
    this.besieged.clear();
    this.threatened.clear();
    const s = v.state;
    for (const a of s.armies) {
      if (a.st === 2) {
        this.besieged.add(a.path[a.seg]);
        continue;
      }
      if (v.spectator || v.me < 0) continue;
      const tgt = a.path[a.path.length - 1];
      const o = s.cities[tgt].o;
      if (o >= 0 && isAlly(s, o, v.me) && !isAlly(s, a.o, v.me)) this.threatened.add(tgt);
    }
  }

  private drawTerritory(v: View) {
    const ctx = this.ctx;
    const s = v.state;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < s.cities.length; i++) {
      const o = s.cities[i].o;
      if (o < 0) continue;
      const c = s.map.cities[i];
      const R = c.level === 3 ? 150 : c.level === 2 ? 125 : 105;
      ctx.drawImage(this.glow(v.colors[o] || COL_NEUTRAL), c.x - R, c.y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const u = this.k / this.cam.z;
    ctx.lineCap = "round";
    ctx.lineWidth = 2.6 * u;
    for (const r of s.map.roads) {
      const oa = s.cities[r.a].o;
      if (oa < 0 || s.cities[r.b].o !== oa) continue;
      const A = s.map.cities[r.a];
      const B = s.map.cities[r.b];
      ctx.strokeStyle = tint(v.colors[oa] || COL_NEUTRAL, 0.42);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
  }

  private drawRoutes(v: View) {
    const ctx = this.ctx;
    const s = v.state;
    const cs = s.map.cities;
    const u = this.k / this.cam.z;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const a of s.armies) {
      if (a.st === 2 || a.seg >= a.path.length - 1) continue;
      const tgt = a.path[a.path.length - 1];
      const mine = a.o === v.me;
      const to = s.cities[tgt].o;
      const threat = !v.spectator && v.me >= 0 && !isAlly(s, a.o, v.me) && to >= 0 && isAlly(s, to, v.me);
      const vp = this.vis.get(a.id);
      ctx.strokeStyle = threat ? "#ff3b4e" : v.colors[a.o] || COL_NEUTRAL;
      ctx.globalAlpha = threat ? 0.75 : mine ? 0.6 : 0.24;
      ctx.lineWidth = (threat ? 2.4 : mine ? 2 : 1.4) * u;
      ctx.setLineDash([7 * u, 6 * u]);
      ctx.lineDashOffset = -this.time * 26 * u;
      ctx.beginPath();
      ctx.moveTo(vp ? vp.x : a.x, vp ? vp.y : a.y);
      for (let j = a.seg + 1; j < a.path.length; j++) ctx.lineTo(cs[a.path[j]].x, cs[a.path[j]].y);
      ctx.stroke();
    }
    if (v.preview && v.preview.path.length > 1) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = v.preview.ok === 2 ? "#fb7185" : v.strikeMode ? "#fb923c" : "#e0f2fe";
      ctx.lineWidth = 3 * u;
      ctx.setLineDash([10 * u, 7 * u]);
      ctx.lineDashOffset = -this.time * 60 * u;
      ctx.beginPath();
      const p0 = cs[v.preview.path[0]];
      ctx.moveTo(p0.x, p0.y);
      for (let j = 1; j < v.preview.path.length; j++) ctx.lineTo(cs[v.preview.path[j]].x, cs[v.preview.path[j]].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private star(x: number, y: number, r: number, col: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#04101c";
    ctx.stroke();
  }

  private rrect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private drawCities(v: View) {
    const ctx = this.ctx;
    const s = v.state;
    const k = this.k;
    const t = this.time;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < s.cities.length; i++) {
      const mc = s.map.cities[i];
      const c = s.cities[i];
      this.w2s(mc.x, mc.y);
      const x = this.px;
      const y = this.py;
      if (x < -70 || y < -70 || x > this.W + 70 || y > this.H + 70) continue;
      const col = c.o >= 0 ? v.colors[c.o] || COL_NEUTRAL : COL_NEUTRAL;
      let r = this.cityR(mc.level);
      const pu = this.pulses.get(i);
      if (pu) {
        const a = (t - pu.t) / 0.7;
        if (a >= 1) this.pulses.delete(i);
        else r *= 1 + 0.5 * pu.s * Math.sin(a * Math.PI) * (1 - a);
      }

      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = c.o >= 0 ? 0.5 : 0.18;
      const g = r * 3;
      ctx.drawImage(this.glow(col), x - g, y - g, g * 2, g * 2);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      const sieged = this.besieged.has(i);
      if (sieged || this.threatened.has(i)) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 8);
        ctx.strokeStyle = sieged ? "#ff2d48" : "#ff6b6b";
        ctx.globalAlpha = 0.35 + pulse * 0.5;
        ctx.lineWidth = 2 * k;
        ctx.beginPath();
        ctx.arc(x, y, r + 6 * k + pulse * 3 * k, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const sel = v.sources.includes(i);
      const insp = v.inspect === i;
      const tgt = v.target === i || v.hoverCity === i;
      if (sel || insp || tgt) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * (sel ? 1.6 : -1.2));
        ctx.strokeStyle = sel ? "#ffffff" : v.strikeMode ? "#fb923c" : insp ? "#cbd5e1" : "#fde68a";
        ctx.lineWidth = 2.2 * k;
        ctx.setLineDash([6 * k, 5 * k]);
        ctx.beginPath();
        ctx.arc(0, 0, r + 7 * k, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = "#06111d";
      ctx.fill();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(1.6, 2.6 * k);
      ctx.strokeStyle = col;
      ctx.stroke();
      if (mc.level >= 2) {
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.6 * k, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (mc.capital) this.star(x, y - r - 5 * k, 5.5 * k, c.o >= 0 ? "#fde047" : "#94a3b8");

      const pw = String(cityPower(c));
      ctx.font = `800 ${Math.round((mc.level === 3 ? 13.5 : 12) * k)}px ${FONT}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(2,6,12,0.85)";
      ctx.strokeText(pw, x, y + 0.5);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(pw, x, y + 0.5);

      if (c.t > 0) {
        const bx = x + r * 0.78;
        const by = y + r * 0.82;
        const label = String(c.t);
        ctx.font = `800 ${Math.round(8.5 * k)}px ${FONT}`;
        const w = ctx.measureText(label).width + 13 * k;
        const h = 10 * k;
        this.rrect(bx - 4 * k, by - h / 2, w, h, 3 * k);
        ctx.fillStyle = "#04101c";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = col;
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillRect(bx - 1.5 * k, by - 2 * k, 6 * k, 4 * k);
        ctx.fillRect(bx + 3.5 * k, by - 0.6 * k, 3 * k, 1.2 * k);
        ctx.fillStyle = "#e2e8f0";
        ctx.textAlign = "left";
        ctx.fillText(label, bx + 7.5 * k, by + 0.5);
        ctx.textAlign = "center";
      }

      if (k >= 0.95 || sel || insp || v.hoverCity === i) {
        ctx.font = `600 ${Math.round(9.5 * k)}px ${FONT}`;
        ctx.globalAlpha = 0.78;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(2,6,12,0.7)";
        ctx.strokeText(mc.name, x, y + r + 11 * k);
        ctx.fillStyle = "#cfe8ff";
        ctx.fillText(mc.name, x, y + r + 11 * k);
        ctx.globalAlpha = 1;
      }
    }
  }

  private tank(x: number, y: number, cx: number, cy: number, col: string, k: number) {
    const ctx = this.ctx;
    const L = 5.5 * k;
    const W = 3.8 * k;
    ctx.beginPath();
    ctx.moveTo(x + cx * L - cy * W, y + cy * L + cx * W);
    ctx.lineTo(x + cx * L + cy * W, y + cy * L - cx * W);
    ctx.lineTo(x - cx * L + cy * W, y - cy * L - cx * W);
    ctx.lineTo(x - cx * L - cy * W, y - cy * L + cx * W);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#04101c";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + cx * 9 * k, y + cy * 9 * k);
    ctx.lineWidth = 1.8 * k;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2.4 * k, 0, TAU);
    ctx.fillStyle = "#04101c";
    ctx.fill();
  }

  private rel(v: View, o: number): number {
    if (o < 0) return 3;
    if (o === v.me) return 0;
    return v.me >= 0 && isAlly(v.state, o, v.me) ? 1 : 2;
  }

  private drawArmies(v: View) {
    const ctx = this.ctx;
    const s = v.state;
    const k = this.k;
    const cs = s.map.cities;
    const t = this.time;
    for (const a of s.armies) {
      const vp = this.vis.get(a.id);
      if (!vp) continue;
      this.w2s(vp.x, vp.y);
      let x = this.px;
      let y = this.py;
      if (x < -50 || y < -50 || x > this.W + 50 || y > this.H + 50) continue;
      const col = v.colors[a.o] || COL_NEUTRAL;
      const rel = this.rel(v, a.o);
      let hx: number;
      let hy: number;
      if (a.st === 0 && a.seg < a.path.length - 1) {
        const A = cs[a.path[a.seg]];
        const B = cs[a.path[a.seg + 1]];
        hx = B.x - A.x;
        hy = B.y - A.y;
      } else {
        const C = cs[a.path[a.seg]];
        hx = C.x - a.x;
        hy = C.y - a.y;
      }
      if (this.cam.rot) {
        const tmp = hx;
        hx = -hy;
        hy = tmp;
      }
      const hl = Math.hypot(hx, hy) || 1;
      const cx = hx / hl;
      const cy = hy / hl;
      const fighting = a.f > 0 || a.st === 2;
      if (fighting) {
        x += (Math.random() - 0.5) * 1.6 * k;
        y += (Math.random() - 0.5) * 1.6 * k;
      }
      const nT = Math.min(3, a.t);
      const nI = Math.min(7, Math.ceil(a.i / 3));
      for (let j = 0; j < nT + nI; j++) {
        const row = 1 + (j >> 1);
        const side = (j & 1 ? 1 : -1) * (5 + row * 1.5) * k;
        const back = (7 + row * 7) * k;
        const px = x - cx * back - cy * side;
        const py = y - cy * back + cx * side;
        if (j < nT) this.tank(px, py, cx, cy, col, k);
        else {
          const bob = a.st === 0 && !fighting ? Math.sin(t * 13 + j * 1.9) * 1.1 * k : 0;
          ctx.beginPath();
          ctx.arc(px, py + bob, 2.7 * k, 0, TAU);
          ctx.fillStyle = "#04101c";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py + bob, 1.9 * k, 0, TAU);
          ctx.fillStyle = col;
          ctx.fill();
        }
      }
      const pw = armyPower(a);
      const br = (pw >= 100 ? 11 : 9.5) * k;
      const ring = v.spectator ? col : REL_COL[rel];
      ctx.beginPath();
      ctx.arc(x, y, br + 2.4 * k, 0, TAU);
      ctx.fillStyle = ring;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, br + 1 * k, 0, TAU);
      ctx.fillStyle = "#04101c";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, br, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
      if (a.st === 0 && !fighting) {
        const tx = x + cx * (br + 5 * k);
        const ty = y + cy * (br + 5 * k);
        ctx.beginPath();
        ctx.moveTo(tx + cx * 4 * k, ty + cy * 4 * k);
        ctx.lineTo(tx - cy * 3.5 * k, ty + cx * 3.5 * k);
        ctx.lineTo(tx + cy * 3.5 * k, ty - cx * 3.5 * k);
        ctx.closePath();
        ctx.fillStyle = ring;
        ctx.fill();
      }
      if (rel === 2 && !v.spectator) {
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1.6 * k;
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const an = q * (Math.PI / 2) + Math.PI / 4;
          ctx.moveTo(x + Math.cos(an) * (br + 3.5 * k), y + Math.sin(an) * (br + 3.5 * k));
          ctx.lineTo(x + Math.cos(an) * (br + 7 * k), y + Math.sin(an) * (br + 7 * k));
        }
        ctx.stroke();
      }
      ctx.font = `800 ${Math.round(10.5 * k)}px ${FONT}`;
      ctx.fillStyle = "#03101c";
      ctx.fillText(String(pw), x, y + 0.5);
      if (v.selArmy === a.id) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 * k;
        ctx.setLineDash([5 * k, 4 * k]);
        ctx.beginPath();
        ctx.arc(0, 0, br + 8 * k, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  private jet(x: number, y: number, cx: number, cy: number, col: string, k: number) {
    const ctx = this.ctx;
    const n = 8 * k;
    const w = 6 * k;
    const b = 4.5 * k;
    ctx.beginPath();
    ctx.moveTo(x + cx * n, y + cy * n);
    ctx.lineTo(x - cx * b - cy * w, y - cy * b + cx * w);
    ctx.lineTo(x - cx * b * 0.3, y - cy * b * 0.3);
    ctx.lineTo(x - cx * b + cy * w, y - cy * b - cx * w);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  }

  private drawStrikes(v: View) {
    const ctx = this.ctx;
    const s = v.state;
    const k = this.k;
    for (const st of s.strikes) {
      const f = st.t / st.dur;
      const col = v.colors[st.o] || "#ffffff";
      if (!st.hit) {
        this.w2s(st.tx, st.ty);
        const R = STRIKE_RADIUS * this.cam.z;
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 12);
        ctx.strokeStyle = "#ff4d4d";
        ctx.globalAlpha = 0.35 + 0.45 * pulse;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(this.px, this.py, R * (1 - 0.12 * pulse), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(this.px - R * 0.5, this.py);
        ctx.lineTo(this.px + R * 0.5, this.py);
        ctx.moveTo(this.px, this.py - R * 0.5);
        ctx.lineTo(this.px, this.py + R * 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const alpha = f > 1 ? Math.max(0, 1 - (st.t - st.dur) / 1.4) : 1;
      if (alpha <= 0) continue;
      const wx = st.fx + (st.tx - st.fx) * f;
      const wy = st.fy + (st.ty - st.fy) * f;
      let dx = st.tx - st.fx;
      let dy = st.ty - st.fy;
      if (this.cam.rot) {
        const tmp = dx;
        dx = -dy;
        dy = tmp;
      }
      const L = Math.hypot(dx, dy) || 1;
      const cx = dx / L;
      const cy = dy / L;
      this.w2s(wx, wy);
      const x = this.px;
      const y = this.py;
      ctx.globalAlpha = alpha;
      const tail = 80 * k;
      const grad = ctx.createLinearGradient(x, y, x - cx * tail, y - cy * tail);
      grad.addColorStop(0, "rgba(255,255,255,0.55)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      for (let q = -1; q <= 1; q++) {
        const ox = -cx * Math.abs(q) * 10 * k - cy * q * 10 * k;
        const oy = -cy * Math.abs(q) * 10 * k + cx * q * 10 * k;
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox - cx * tail, y + oy - cy * tail);
      }
      ctx.stroke();
      for (let q = -1; q <= 1; q++) {
        const jx = x - cx * Math.abs(q) * 10 * k - cy * q * 10 * k;
        const jy = y - cy * Math.abs(q) * 10 * k + cx * q * 10 * k;
        this.jet(jx + 7 * k, jy + 10 * k, cx, cy, "rgba(0,0,0,0.35)", k);
        this.jet(jx, jy, cx, cy, col, k);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawParts(additive: boolean) {
    const ctx = this.ctx;
    const k = this.k;
    for (const p of this.parts) {
      if (!p.on) continue;
      const add = p.k === 0 || p.k === 3 || p.k === 5;
      if (add !== additive) continue;
      const t = p.life / p.max;
      this.w2s(p.ax, p.ay);
      const x = this.px + p.x * k;
      const y = this.py + p.y * k;
      if (x < -100 || y < -100 || x > this.W + 100 || y > this.H + 100) continue;
      switch (p.k) {
        case 0: {
          ctx.strokeStyle = p.col;
          ctx.globalAlpha = 1 - t;
          ctx.lineWidth = Math.max(0.8, p.s0 * k * (1 - t * 0.5));
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - p.vx * 0.045 * k, y - p.vy * 0.045 * k);
          ctx.stroke();
          break;
        }
        case 1: {
          const r = (p.s0 + (p.s1 - p.s0) * t) * k;
          ctx.globalAlpha = (1 - t) * 0.42;
          ctx.fillStyle = p.col;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
          break;
        }
        case 2: {
          const e = 1 - (1 - t) * (1 - t) * (1 - t);
          const r = (p.s0 + (p.s1 - p.s0) * e) * k;
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.strokeStyle = p.col;
          ctx.lineWidth = Math.max(1, 3 * k * (1 - t));
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.stroke();
          break;
        }
        case 3: {
          const r = (p.s0 + (p.s1 - p.s0) * t) * k;
          ctx.globalAlpha = 1 - t;
          ctx.drawImage(this.glow(p.col), x - r, y - r, r * 2, r * 2);
          break;
        }
        case 4: {
          ctx.globalAlpha = 1 - t * t;
          ctx.fillStyle = p.col;
          const sz = p.s0 * k;
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
          break;
        }
        default: {
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = p.col;
          const sz = Math.max(0.5, p.s0 * k * (1 - t));
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts() {
    const ctx = this.ctx;
    const k = Math.max(0.9, this.k);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const t of this.texts) {
      const a = t.life / t.max;
      this.w2s(t.ax, t.ay);
      const y = this.py - 18 * k - a * 38;
      const sc = a < 0.15 ? 1 + (1 - a / 0.15) * 0.6 : 1;
      ctx.globalAlpha = a > 0.7 ? 1 - (a - 0.7) / 0.3 : 1;
      ctx.font = `900 ${Math.round(t.size * sc * k)}px ${FONT}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(2,6,12,0.85)";
      ctx.strokeText(t.text, this.px, y);
      ctx.fillStyle = t.col;
      ctx.fillText(t.text, this.px, y);
    }
    ctx.globalAlpha = 1;
  }

  private arrow(x0: number, y0: number, x1: number, y1: number, col: string) {
    const ctx = this.ctx;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    if (L < 8) return;
    const mx = (x0 + x1) / 2 - dy * 0.12;
    const my = (y0 + y1) / 2 + dx * 0.12;
    ctx.lineCap = "round";
    ctx.strokeStyle = tint(col.startsWith("#") ? col : "#ffffff", 0.22);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.5;
    ctx.setLineDash([12, 8]);
    ctx.lineDashOffset = -this.time * 80;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    const ax = x1 - mx;
    const ay = y1 - my;
    const al = Math.hypot(ax, ay) || 1;
    const ux = ax / al;
    const uy = ay / al;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x1 + ux * 6, y1 + uy * 6);
    ctx.lineTo(x1 - ux * 10 - uy * 8, y1 - uy * 10 + ux * 8);
    ctx.lineTo(x1 - ux * 10 + uy * 8, y1 - uy * 10 - ux * 8);
    ctx.closePath();
    ctx.fill();
  }

  private drawOverlay(v: View) {
    const ctx = this.ctx;
    const s = v.state;
    const cs = s.map.cities;
    const k = this.k;
    if (v.drag) {
      const col = v.colors[v.me] || "#ffffff";
      for (const src of v.sources) {
        this.w2s(cs[src].x, cs[src].y);
        this.arrow(this.px, this.py, v.drag.x, v.drag.y, col);
      }
      if (v.selArmy) {
        const p = this.armyScreen(v.selArmy);
        if (p) this.arrow(p.x, p.y, v.drag.x, v.drag.y, col);
      }
    }
    if (v.preview && v.preview.ok && v.preview.path.length > 1) {
      const last = cs[v.preview.path[v.preview.path.length - 1]];
      this.w2s(last.x, last.y);
      const r = this.cityR(last.level);
      const good = v.preview.ok === 1;
      const label = `${good ? "✓" : "✗"} ${v.preview.send} vs ${Math.ceil(v.preview.def)}`;
      ctx.font = `800 ${Math.round(11 * Math.max(1, k))}px ${FONT}`;
      const w = ctx.measureText(label).width + 16;
      const h = 21;
      const bx = this.px - w / 2;
      const by = this.py - r - 22 * k - h;
      this.rrect(bx, by, w, h, 7);
      ctx.fillStyle = good ? "rgba(22,163,74,0.95)" : "rgba(225,29,72,0.95)";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, this.px, by + h / 2 + 0.5);
    }
    if (v.hint) {
      const A = cs[v.hint.from];
      const B = cs[v.hint.to];
      if (A && B) {
        this.w2s(A.x, A.y);
        const x0 = this.px;
        const y0 = this.py;
        this.w2s(B.x, B.y);
        const x1 = this.px;
        const y1 = this.py;
        const ph = (this.time % 1.8) / 1.8;
        const e0 = Math.min(1, ph / 0.7);
        const e = 0.14 + 0.86 * (e0 < 0.5 ? 2 * e0 * e0 : 1 - Math.pow(-2 * e0 + 2, 2) / 2);
        const hx = x0 + (x1 - x0) * e;
        const hy = y0 + (y1 - y0) * e;
        ctx.globalAlpha = 0.9 * (ph < 0.85 ? 1 : 1 - (ph - 0.85) / 0.15);
        this.arrow(x0, y0, hx, hy, "#ffffff");
        ctx.beginPath();
        ctx.arc(hx, hy, 15, 0, TAU);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 6 + 2.5 * Math.sin(this.time * 10), 0, TAU);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Red arrows at the screen edge pointing to off-screen friendly cities under attack. */
  private drawEdgeAlerts(v: View) {
    if (v.spectator || !this.threatened.size) return;
    const ctx = this.ctx;
    const cs = v.state.map.cities;
    const m = 26;
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 9);
    for (const ci of this.threatened) {
      const c = cs[ci];
      this.w2s(c.x, c.y);
      if (this.px > 0 && this.py > this.insetTop && this.px < this.W && this.py < this.H - this.insetBottom) continue;
      const dx = this.px - this.vcx;
      const dy = this.py - this.vcy;
      const sx = (this.W / 2 - m) / Math.max(1e-3, Math.abs(dx));
      const sy = (this.availH / 2 - m) / Math.max(1e-3, Math.abs(dy));
      const sc = Math.min(sx, sy);
      const x = this.vcx + dx * sc;
      const y = this.vcy + dy * sc;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L;
      const uy = dy / L;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#ff2d48";
      ctx.beginPath();
      ctx.moveTo(x + ux * 14, y + uy * 14);
      ctx.lineTo(x - uy * 10, y + ux * 10);
      ctx.lineTo(x + uy * 10, y - ux * 10);
      ctx.closePath();
      ctx.fill();
      ctx.font = `900 12px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", x + ux * 2, y + uy * 2);
      ctx.globalAlpha = 1;
    }
  }
}
