import { Renderer, type Preview, type View } from "./render";
import { sfx } from "./audio";
import {
  applyCommand,
  armyPower,
  cityDist,
  cityPower,
  createGame,
  defenseOf,
  findPath,
  isAlly,
  playerStats,
  step,
  type NewPlayer,
} from "./sim";
import { runAI } from "./ai";
import { NetClient, type LobbyAction, type LobbyPlayerInfo, type SyncResponse } from "./net";
import { saveLocalScore } from "./highscores";
import * as K from "./constants";
import type { Army, CityState, Command, Difficulty, GameEvent, GameState, GameMap, Mode } from "./types";

export type Phase = "menu" | "connecting" | "lobby" | "playing" | "over";
export type LocalMode = "ffa" | "teams" | "duel";
export interface LocalOpts {
  name: string;
  mode: LocalMode;
  diff: Difficulty;
}

export interface LobbyInfo {
  code: string;
  name: string;
  status: string;
  mode: Mode;
  maxPlayers: number;
  isPublic: boolean;
  hostId: string;
  you: string;
  players: LobbyPlayerInfo[];
  autoStartIn: number;
}

export interface HudPlayer {
  idx: number;
  name: string;
  color: string;
  rel: number;
  cities: number;
  power: number;
  alive: boolean;
  score: number;
  bot: boolean;
  afk: boolean;
  team: number;
}

export interface SelInfo {
  kind: "city" | "army";
  name: string;
  own: boolean;
  rel: number;
  ownerName: string;
  ownerColor: string;
  level: number;
  capital: boolean;
  inf: number;
  tanks: number;
  power: number;
  multi: number;
  dest: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: "good" | "bad" | "info" | "gold";
}

export interface ResultInfo {
  win: boolean;
  over: boolean;
  score: number;
  captures: number;
  kills: number;
  time: number;
  newRecord: boolean;
  rank: number;
  winners: string[];
  title: string;
}

export interface Hud {
  phase: Phase;
  paused: boolean;
  online: boolean;
  spectate: boolean;
  gold: number;
  income: number;
  score: number;
  streak: number;
  time: number;
  timeLimit: number;
  myCities: number;
  totalCities: number;
  players: HudPlayer[];
  sel: SelInfo | null;
  sendMode: 0 | 1 | 2;
  strikeCd: number;
  strikeMode: boolean;
  toasts: Toast[];
  result: ResultInfo | null;
  lobby: LobbyInfo | null;
  muted: boolean;
  hint: boolean;
  error: string | null;
  alive: boolean;
  ping: number;
  modeLabel: string;
  isHost: boolean;
  coarse: boolean;
}

const EMPTY_HUD: Hud = {
  phase: "menu",
  paused: false,
  online: false,
  spectate: false,
  gold: 0,
  income: 0,
  score: 0,
  streak: 0,
  time: 0,
  timeLimit: 0,
  myCities: 0,
  totalCities: 0,
  players: [],
  sel: null,
  sendMode: 0,
  strikeCd: 0,
  strikeMode: false,
  toasts: [],
  result: null,
  lobby: null,
  muted: false,
  hint: false,
  error: null,
  alive: false,
  ping: 0,
  modeLabel: "",
  isHost: false,
  coarse: false,
};

class Store<T> {
  private v: T;
  private ls = new Set<() => void>();
  constructor(v: T) {
    this.v = v;
  }
  get = (): T => this.v;
  set(v: T) {
    this.v = v;
    this.ls.forEach((l) => l());
  }
  subscribe = (l: () => void) => {
    this.ls.add(l);
    return () => {
      this.ls.delete(l);
    };
  };
}

export const hudStore = new Store<Hud>(EMPTY_HUD);

const BOT_NAMES = ["Gral. Ramírez", "Mariscal Vega", "Cnel. Ortiz", "Alm. Rojas", "Cap. Duarte", "Gral. Navarro", "Cmdte. Ibarra"];
const MODE_LABEL: Record<LocalMode, string> = { ffa: "Todos contra todos", teams: "Equipos 2v2", duel: "Duelo 1v1" };
const DIFF_LABEL: Record<Difficulty, string> = { easy: "Fácil", normal: "Normal", hard: "Difícil" };

interface PrevArmy {
  o: number;
  p: number;
  x: number;
  y: number;
  st: number;
  f: number;
  n: number;
  dst: number;
}

interface Drag {
  kind: "send" | "army" | "pan";
  moved: boolean;
  sx: number;
  sy: number;
  x: number;
  y: number;
  srcs: number[];
  army: string | null;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

const randSeed = () => Math.floor(Math.random() * 2147483647);

function computeColors(s: GameState, me: number): string[] {
  if (me < 0) return s.players.map((_, i) => K.COL_SPECTATE[i % K.COL_SPECTATE.length]);
  let ai = 0;
  let ei = 0;
  return s.players.map((_, i) =>
    i === me ? K.COL_ME : isAlly(s, i, me) ? K.COL_ALLY[ai++ % K.COL_ALLY.length] : K.COL_ENEMY[ei++ % K.COL_ENEMY.length],
  );
}

function mkPrev(a: Army): PrevArmy {
  return { o: a.o, p: armyPower(a), x: a.x, y: a.y, st: a.st, f: a.f, n: a.path[a.seg], dst: a.path[a.path.length - 1] };
}

export class Engine {
  readonly r: Renderer;
  state: GameState | null = null;
  me = -1;
  kind: "demo" | "local" | "online" = "demo";
  phase: Phase = "menu";
  paused = false;
  colors: string[] = [];
  sources: number[] = [];
  selArmy: string | null = null;
  inspect = -1;
  target = -1;
  hoverCity = -1;
  sendMode: 0 | 1 | 2 = 0;
  strikeMode = false;
  spectate = false;

  private localOpts: LocalOpts = { name: "Comandante", mode: "ffa", diff: "normal" };
  private net: NetClient | null = null;
  private lobby: LobbyInfo | null = null;
  private gid = -1;
  private map: GameMap | null = null;
  private error: string | null = null;
  private result: ResultInfo | null = null;
  private resultSaved = false;
  private prevC: { o: number; p: number }[] = [];
  private prevA = new Map<string, PrevArmy>();
  private prevS = new Map<string, boolean>();
  private gone = new Map<string, number>();
  private cur = new Set<string>();
  private lastEv = 0;
  private toasts: (Toast & { until: number })[] = [];
  private toastSeq = 0;
  private hint: { from: number; to: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: Drag | null = null;
  private pinch: { d: number; mx: number; my: number } | null = null;
  private keys = new Set<string>();
  private preview: (Preview & { key: string; at: number }) | null = null;
  private raf = 0;
  private lastT = 0;
  private hudAt = 0;
  private dirtyHud = true;
  private idSeq = 0;
  private demoOverAt = 0;
  private lastThreat = -99;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.r = new Renderer(canvas);
  }

  // ================================================================ lifecycle

  start() {
    this.attach();
    this.onResize();
    this.startDemo();
    this.phase = "menu";
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.dirty();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.detach();
    if (this.net) this.net.stopped = true;
    this.net = null;
  }

  private attach() {
    const c = this.r.canvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onCancel);
    c.addEventListener("pointerleave", this.onLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", this.onContext);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVis);
  }

  private detach() {
    const c = this.r.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
    c.removeEventListener("pointerleave", this.onLeave);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
  }

  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    try {
      this.tick(dt, now);
    } catch (e) {
      console.error(e);
    }
  };

  private tick(dt: number, now: number) {
    this.panKeys(dt);
    if (this.net) this.net.tick(now);
    const s = this.state;
    if (s) {
      if (this.kind === "online") {
        if (!s.over) step(s, dt);
      } else if (!this.paused && !s.over) {
        step(s, dt, runAI);
      }
      if (this.kind !== "online") this.processEvents();
      this.validateSel();
      this.effects();
      if (this.kind === "demo") {
        if (s.over) {
          if (!this.demoOverAt) this.demoOverAt = now;
          else if (now - this.demoOverAt > 2500) this.startDemo();
        }
        const t = this.r.time;
        this.r.cam.x = s.map.w / 2 + Math.sin(t * 0.06) * 260;
        this.r.cam.y = s.map.h / 2 + Math.cos(t * 0.045) * 160;
        this.r.clampCam();
      } else {
        this.checkGameOver();
        if (this.hint && s.time > 25) {
          this.hint = null;
          this.dirty();
        }
      }
      this.updatePreview(now);
    }
    this.r.update(dt);
    this.r.render(this.view(), dt);
    if (this.dirtyHud || now - this.hudAt > 110) {
      this.emitHud();
      this.hudAt = now;
      this.dirtyHud = false;
    }
  }

  private dirty() {
    this.dirtyHud = true;
  }

  // ================================================================ game setup

  private setState(st: GameState) {
    this.state = st;
    this.colors = computeColors(st, this.me);
    this.sources = [];
    this.selArmy = null;
    this.inspect = -1;
    this.target = -1;
    this.hoverCity = -1;
    this.strikeMode = false;
    this.preview = null;
    this.drag = null;
    this.r.setMap(st.map);
    this.prevC = st.cities.map((c) => ({ o: c.o, p: cityPower(c) }));
    this.prevA.clear();
    for (const a of st.armies) this.prevA.set(a.id, mkPrev(a));
    this.prevS.clear();
    for (const k of st.strikes) this.prevS.set(k.id, k.hit);
    this.gone.clear();
    this.lastEv = st.evSeq;
    this.toasts = [];
    this.demoOverAt = 0;
  }

  private startDemo() {
    this.kind = "demo";
    this.me = -1;
    this.paused = false;
    this.spectate = false;
    const names = shuffle(BOT_NAMES.slice());
    const players: NewPlayer[] = [0, 1, 2, 3].map((i) => ({ id: "d" + i, name: names[i], team: i, bot: true, diff: "hard" as Difficulty }));
    this.setState(createGame(randSeed(), "ffa", players, 100000));
    this.r.fitNow();
    this.r.cam.z = this.r.fitZ * 1.2;
    this.r.clampCam();
    this.hint = null;
  }

  startLocal(opts: LocalOpts) {
    this.stopNet(true);
    this.localOpts = opts;
    const n = opts.mode === "duel" ? 2 : 4;
    const names = shuffle(BOT_NAMES.slice());
    const players: NewPlayer[] = [{ id: "me", name: opts.name || "Comandante", team: 0, bot: false, diff: opts.diff }];
    for (let i = 1; i < n; i++) {
      players.push({ id: "bot" + i, name: names[i - 1], team: opts.mode === "teams" ? (i === 1 ? 0 : 1) : i, bot: true, diff: opts.diff });
    }
    this.kind = "local";
    this.me = 0;
    this.paused = false;
    this.spectate = false;
    this.result = null;
    this.resultSaved = false;
    this.lobby = null;
    this.error = null;
    this.setState(createGame(randSeed(), opts.mode === "teams" ? "teams" : "ffa", players));
    this.phase = "playing";
    this.introCamera();
    this.prepareHint();
    sfx.unlock();
    sfx.play("start");
    this.toast(opts.mode === "teams" ? "Equipos 2v2: coordina con tu aliado verde" : "¡Conquista el mapa!", "info");
    this.dirty();
  }

  private introCamera() {
    const s = this.state;
    if (!s) return;
    this.r.setMap(s.map);
    this.r.fitNow();
    if (this.me < 0) return;
    const cap = s.map.cities[s.players[this.me].capital];
    if (!cap) return;
    const fz = this.r.fitZ;
    const targetZ = fz < 0.62 ? Math.min(0.8, fz * 1.9) : fz * 1.1;
    this.r.cam.z = fz * 0.94;
    this.r.focus(cap.x, cap.y, targetZ);
  }

  private prepareHint() {
    this.hint = null;
    const s = this.state;
    if (!s || this.me < 0) return;
    const cap = s.players[this.me].capital;
    if (cap < 0) return;
    let best = -1;
    let bv = Infinity;
    for (const nb of s.map.cities[cap].adj) {
      const c = s.cities[nb];
      if (c.o >= 0) continue;
      const v = cityPower(c) * 20 + cityDist(s, cap, nb);
      if (v < bv) {
        bv = v;
        best = nb;
      }
    }
    if (best >= 0) this.hint = { from: cap, to: best };
  }

  // ================================================================ public actions (UI)

  restart() {
    if (this.kind === "local") {
      this.startLocal(this.localOpts);
      return;
    }
    if (this.kind === "online" && this.net && this.lobby) {
      if (this.lobby.hostId === this.lobby.you) {
        this.net.act({ k: "restart" });
        this.toast("Reiniciando partida…", "info");
      } else this.toast("Solo el anfitrión puede reiniciar", "info");
    }
  }

  toMenu() {
    this.stopNet(true);
    this.result = null;
    this.paused = false;
    this.spectate = false;
    this.error = null;
    if (this.kind !== "demo") this.startDemo();
    this.phase = "menu";
    this.dirty();
  }

  togglePause() {
    if (this.phase !== "playing") return;
    this.paused = !this.paused;
    this.keys.clear();
    this.drag = null;
    this.pointers.clear();
    sfx.play("click");
    this.dirty();
  }

  spectateNow() {
    if (this.phase !== "over" || !this.state || this.state.over) return;
    this.spectate = true;
    this.phase = "playing";
    this.dirty();
  }

  toggleMute() {
    sfx.unlock();
    sfx.setMuted(!sfx.muted);
    this.dirty();
  }

  cycleSendMode() {
    this.setSendMode(((this.sendMode + 1) % 3) as 0 | 1 | 2);
  }

  setSendMode(m: 0 | 1 | 2) {
    this.sendMode = m;
    sfx.play("click");
    this.dirty();
  }

  fitView() {
    if (this.state) this.r.focus(this.state.map.w / 2, this.state.map.h / 2, this.r.fitZ);
  }

  centerCapital() {
    const s = this.state;
    if (!s || this.me < 0) return;
    let ci = s.players[this.me].capital;
    if (ci < 0 || s.cities[ci].o !== this.me) ci = s.cities.findIndex((c) => c.o === this.me);
    if (ci < 0) return;
    const c = s.map.cities[ci];
    this.r.focus(c.x, c.y, Math.max(this.r.cam.z, Math.min(0.9, this.r.fitZ * 1.8)));
  }

  buyTank(n = 1) {
    const s = this.state;
    if (!s || this.me < 0 || this.phase !== "playing" || this.spectate) return;
    const c = this.tankCity();
    if (c < 0) return;
    if (s.players[this.me].gold < K.TANK_COST) {
      sfx.play("error");
      this.toast(`Necesitas ${K.TANK_COST} de oro`, "info");
      return;
    }
    if (this.issue({ k: "tank", city: c, n })) {
      sfx.play("buy");
      const mc = s.map.cities[c];
      this.r.text(mc.x, mc.y, "+TANQUE", "#fde047", 13, 0.9);
      this.r.cityPulse(c, 0.5);
      this.r.ring(mc.x, mc.y, "#fde047", 6, 34, 0.4);
    }
    this.dirty();
  }

  strikeButton() {
    const s = this.state;
    if (!s || this.me < 0 || this.phase !== "playing" || this.spectate) return;
    const cand = [this.target, this.inspect].find((c) => c >= 0 && this.hostile(c));
    if (cand !== undefined) {
      this.launchStrike(cand);
      return;
    }
    this.strikeMode = !this.strikeMode;
    sfx.play("click");
    this.dirty();
  }

  cancelStrike() {
    this.strikeMode = false;
    this.dirty();
  }

  clearSel(sound = true) {
    if (sound && (this.sources.length || this.selArmy || this.inspect >= 0)) sfx.play("click");
    this.sources = [];
    this.selArmy = null;
    this.inspect = -1;
    this.target = -1;
    this.strikeMode = false;
    this.preview = null;
    this.dirty();
  }

  // ---------------------------------------------------------------- online

  startOnline(code: string, token: string) {
    this.stopNet(false);
    if (this.kind !== "demo") this.startDemo();
    this.error = null;
    this.lobby = null;
    this.gid = -1;
    this.map = null;
    this.result = null;
    this.net = new NetClient(code, token, this.onNet, this.onNetFail);
    this.net.interval = 0;
    this.phase = "connecting";
    try {
      sessionStorage.setItem("dominio.session", JSON.stringify({ code, token }));
    } catch {
      /* ignore */
    }
    sfx.unlock();
    this.dirty();
  }

  lobbyAction(a: LobbyAction) {
    if (this.net) {
      this.net.act(a);
      sfx.play("click");
    }
  }

  private stopNet(leave: boolean) {
    if (this.net) {
      if (leave) this.net.leave();
      else this.net.stopped = true;
      this.net = null;
      if (leave) {
        try {
          sessionStorage.removeItem("dominio.session");
        } catch {
          /* ignore */
        }
      }
    }
    this.lobby = null;
  }

  private onNet = (d: SyncResponse) => {
    const net = this.net;
    if (!net || this.destroyed) return;
    this.error = null;
    if (d.left) return;
    this.lobby = {
      code: d.code,
      name: d.name,
      status: d.status,
      mode: d.mode,
      maxPlayers: d.maxPlayers,
      isPublic: d.isPublic,
      hostId: d.hostId,
      you: d.you,
      players: d.players,
      autoStartIn: d.autoStartIn,
    };
    if (d.status === "lobby" || !d.state) {
      if (this.kind === "online") this.startDemo();
      this.phase = "lobby";
      this.gid = -1;
      this.map = null;
      this.result = null;
      net.needMap = true;
      net.interval = 900;
      this.dirty();
      return;
    }
    if (d.gid !== this.gid || !this.map) {
      if (!d.map) {
        net.needMap = true;
        net.lastAt = 0;
        return;
      }
      this.gid = d.gid;
      this.map = d.map;
      net.needMap = false;
      const st: GameState = { ...d.state, map: d.map };
      this.kind = "online";
      this.me = st.players.findIndex((p) => p.id === d.you);
      this.spectate = this.me < 0;
      this.result = null;
      this.resultSaved = false;
      this.paused = false;
      this.setState(st);
      this.phase = "playing";
      this.introCamera();
      this.prepareHint();
      sfx.play("start");
      this.toast("¡La batalla comienza!", "info");
    } else {
      const st: GameState = { ...d.state, map: this.map };
      this.processEvents(st);
      if (this.me >= 0) for (const pc of net.pending) applyCommand(st, this.me, pc.cmd);
      const lead = Math.min(0.25, net.rtt / 2000);
      if (lead > 0.005 && !st.over) step(st, lead);
      this.state = st;
    }
    net.interval = d.status === "playing" ? 180 : 1500;
    this.dirty();
  };

  private onNetFail = (msg: string, fatal: boolean) => {
    this.error = msg;
    if (fatal) {
      this.stopNet(false);
      try {
        sessionStorage.removeItem("dominio.session");
      } catch {
        /* ignore */
      }
      this.toMenu();
      this.error = msg;
    }
    this.dirty();
  };

  // ================================================================ commands

  private newId() {
    return `${this.me}-${(Date.now() % 1e7).toString(36)}-${++this.idSeq}`;
  }

  private issue(cmd: Command): boolean {
    const s = this.state;
    if (!s || this.me < 0 || this.spectate) return false;
    if (this.kind === "online") {
      if (!applyCommand(s, this.me, cmd)) return false;
      this.net?.queue(cmd);
      return true;
    }
    if (this.kind === "local") return applyCommand(s, this.me, cmd);
    return false;
  }

  private hostile(c: number) {
    const s = this.state;
    if (!s) return false;
    const o = s.cities[c].o;
    return o !== this.me && !(o >= 0 && isAlly(s, o, this.me));
  }

  private sendAmount(c: CityState) {
    if (this.sendMode === 2) return c.t * K.TANK_POWER;
    if (this.sendMode === 1) return cityPower(c);
    return Math.ceil(c.i * 0.5) + Math.round(c.t * 0.5) * K.TANK_POWER;
  }

  private sendFrom(srcs: number[], to: number, clear: boolean) {
    const s = this.state;
    if (!s || this.me < 0) return;
    const tc = s.cities[to];
    if (tc.o >= 0 && tc.o !== this.me && isAlly(s, tc.o, this.me)) {
      this.toast("No puedes atacar a un aliado", "info");
      sfx.play("error");
      return;
    }
    const cmd: Command = {
      k: "send",
      from: srcs,
      to,
      r: this.sendMode === 1 ? 1 : 0.5,
      tk: this.sendMode === 2,
      ids: srcs.map(() => this.newId()),
    };
    if (this.issue(cmd)) {
      sfx.play("send");
      for (const c of srcs) this.r.cityPulse(c, 0.45);
      if (this.hint) this.hint = null;
      if (clear) this.clearSel(false);
    } else {
      sfx.play("error");
      this.toast(this.sendMode === 2 ? "No hay tanques para enviar" : "No hay tropas disponibles", "info");
    }
    this.dirty();
  }

  private redirect(id: string, to: number) {
    if (this.issue({ k: "redirect", army: id, to })) {
      sfx.play("send");
      this.selArmy = null;
      this.target = -1;
    } else {
      sfx.play("error");
      this.toast("Ruta no disponible", "info");
    }
    this.dirty();
  }

  private tankCity(): number {
    const s = this.state;
    if (!s) return -1;
    const me = this.me;
    const sel = this.sources.find((c) => s.cities[c].o === me);
    if (sel !== undefined) return sel;
    if (this.inspect >= 0 && s.cities[this.inspect].o === me) return this.inspect;
    const cap = s.players[me].capital;
    if (cap >= 0 && s.cities[cap].o === me) return cap;
    return s.cities.findIndex((c) => c.o === me);
  }

  private launchStrike(c: number) {
    const s = this.state;
    if (!s || this.me < 0) return;
    const p = s.players[this.me];
    if (!this.hostile(c)) {
      this.toast("Elige una ciudad enemiga o neutral", "info");
      sfx.play("error");
      return;
    }
    if (p.strikeCd > 0) {
      this.toast(`Bombardeo listo en ${Math.ceil(p.strikeCd)} s`, "info");
      sfx.play("error");
      return;
    }
    if (p.gold < K.STRIKE_COST) {
      this.toast(`Necesitas ${K.STRIKE_COST} de oro`, "info");
      sfx.play("error");
      return;
    }
    if (this.issue({ k: "strike", city: c, id: this.newId() })) {
      this.strikeMode = false;
      this.toast("✈ Bombardeo en camino", "gold");
    }
    this.dirty();
  }

  // ================================================================ input

  private local(e: MouseEvent) {
    const rc = this.r.canvas.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  }

  private pickCity(x: number, y: number): { id: number; d2: number } | null {
    const s = this.state;
    if (!s) return null;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < s.map.cities.length; i++) {
      const c = s.map.cities[i];
      this.r.w2s(c.x, c.y);
      const dx = this.r.px - x;
      const dy = this.r.py - y;
      const d2 = dx * dx + dy * dy;
      const rr = Math.max(this.r.coarse ? 28 : 22, this.r.cityR(c.level) + 10);
      if (d2 < rr * rr && d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    return best >= 0 ? { id: best, d2: bd } : null;
  }

  private pickArmy(x: number, y: number, ownOnly: boolean): { id: string; d2: number } | null {
    const s = this.state;
    if (!s) return null;
    let best: string | null = null;
    let bd = Infinity;
    const rr = Math.max(this.r.coarse ? 22 : 16, 12 * this.r.k);
    for (const a of s.armies) {
      if (ownOnly && a.o !== this.me) continue;
      const p = this.r.armyScreen(a.id);
      if (!p) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 < bd) {
        bd = d2;
        best = a.id;
      }
    }
    return best ? { id: best, d2: bd } : null;
  }

  private canCommand() {
    return this.phase === "playing" && !this.paused && !this.spectate && this.me >= 0 && !!this.state;
  }

  private onDown = (e: PointerEvent) => {
    sfx.unlock();
    if (!this.state || this.phase !== "playing" || this.paused) return;
    e.preventDefault();
    const { x, y } = this.local(e);
    try {
      this.r.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 2) {
      this.drag = null;
      this.preview = null;
      const [a, b] = Array.from(this.pointers.values());
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 2) {
      this.pointers.delete(e.pointerId);
      this.rightClick(x, y);
      return;
    }
    const base: Drag = { kind: "pan", moved: false, sx: x, sy: y, x, y, srcs: [], army: null };
    if (this.strikeMode || !this.canCommand()) {
      this.drag = base;
      return;
    }
    const s = this.state;
    const ah = this.pickArmy(x, y, true);
    const ch = this.pickCity(x, y);
    if (ah && (!ch || ah.d2 < ch.d2)) {
      base.kind = "army";
      base.army = ah.id;
    } else if (ch && s.cities[ch.id].o === this.me) {
      base.kind = "send";
      base.srcs = this.sources.includes(ch.id) && this.sources.length > 1 ? this.sources.slice() : [ch.id];
    }
    this.drag = base;
  };

  private onMove = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse" && this.phase === "playing") this.hover(x, y);
      return;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = Array.from(this.pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.r.panBy(mx - this.pinch.mx, my - this.pinch.my);
      if (this.pinch.d > 10 && d > 10) this.r.zoomAt(mx, my, d / this.pinch.d);
      this.pinch.d = d;
      this.pinch.mx = mx;
      this.pinch.my = my;
      return;
    }
    const g = this.drag;
    if (!g) return;
    g.x = x;
    g.y = y;
    if (!g.moved && Math.hypot(x - g.sx, y - g.sy) > (this.r.coarse ? 10 : 6)) g.moved = true;
    if (!g.moved) return;
    if (g.kind === "pan") {
      this.r.panBy(dx, dy);
      this.r.canvas.style.cursor = "grabbing";
      return;
    }
    const ch = this.pickCity(x, y);
    this.hoverCity = ch ? ch.id : -1;
    if (g.kind === "send" && ch && this.state && this.state.cities[ch.id].o === this.me && !g.srcs.includes(ch.id)) {
      g.srcs.push(ch.id);
      this.r.cityPulse(ch.id, 0.4);
      sfx.play("select");
    }
  };

  private onUp = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    const had = this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      return;
    }
    const g = this.drag;
    this.drag = null;
    this.r.canvas.style.cursor = "";
    if (!had || !g || !this.state || this.phase !== "playing") return;
    if (!g.moved) {
      this.tap(x, y, e.shiftKey);
      return;
    }
    const ch = this.pickCity(x, y);
    if (g.kind === "send" && ch) {
      const srcs = g.srcs.filter((c) => c !== ch.id);
      if (srcs.length) this.sendFrom(srcs, ch.id, true);
    } else if (g.kind === "army" && g.army && ch) this.redirect(g.army, ch.id);
    this.hoverCity = -1;
    this.preview = null;
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.drag = null;
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !this.pointers.size) this.hoverCity = -1;
  };

  private onContext = (e: Event) => e.preventDefault();

  private onWheel = (e: WheelEvent) => {
    if (!this.state || this.phase !== "playing") return;
    e.preventDefault();
    const { x, y } = this.local(e);
    this.r.zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  };

  private hover(x: number, y: number) {
    const ch = this.pickCity(x, y);
    this.hoverCity = ch ? ch.id : -1;
    const s = this.state;
    if (!s || !this.canCommand()) return;
    const ownCity = ch && s.cities[ch.id].o === this.me;
    const ownArmy = !ownCity && this.pickArmy(x, y, true);
    this.r.canvas.style.cursor = ownCity || ownArmy ? "pointer" : ch && (this.sources.length || this.selArmy || this.strikeMode) ? "crosshair" : "";
  }

  private rightClick(x: number, y: number) {
    if (!this.canCommand()) return;
    const ch = this.pickCity(x, y);
    if (!ch) {
      this.clearSel();
      return;
    }
    if (this.selArmy) this.redirect(this.selArmy, ch.id);
    else if (this.sources.length) {
      const srcs = this.sources.filter((c) => c !== ch.id);
      if (srcs.length) this.sendFrom(srcs, ch.id, false);
    }
  }

  private tap(x: number, y: number, shift: boolean) {
    const s = this.state;
    if (!s) return;
    const me = this.me;
    const ch = this.pickCity(x, y);
    if (this.strikeMode) {
      if (ch) this.launchStrike(ch.id);
      else this.cancelStrike();
      return;
    }
    if (!this.canCommand()) {
      this.inspect = ch ? ch.id : -1;
      this.dirty();
      return;
    }
    const ah = this.pickArmy(x, y, true);
    if (ah && (!ch || ah.d2 < ch.d2)) {
      this.selArmy = this.selArmy === ah.id ? null : ah.id;
      this.sources = [];
      this.inspect = -1;
      this.target = -1;
      sfx.play("select");
      this.dirty();
      return;
    }
    if (ch) {
      const c = ch.id;
      const own = s.cities[c].o === me;
      if (shift && own) {
        const i = this.sources.indexOf(c);
        if (i >= 0) this.sources.splice(i, 1);
        else this.sources.push(c);
        this.selArmy = null;
        this.inspect = -1;
        sfx.play("select");
        this.dirty();
        return;
      }
      if (this.selArmy) {
        this.redirect(this.selArmy, c);
        return;
      }
      if (this.sources.length && !this.sources.includes(c)) {
        this.sendFrom(this.sources.slice(), c, true);
        return;
      }
      if (own) {
        this.sources = this.sources.length === 1 && this.sources[0] === c ? [] : [c];
        this.inspect = -1;
        this.target = -1;
        sfx.play("select");
        this.r.cityPulse(c, 0.3);
      } else {
        this.inspect = this.inspect === c ? -1 : c;
        this.sources = [];
        this.target = -1;
        sfx.play("click");
      }
      this.dirty();
      return;
    }
    this.clearSel();
  }

  private onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (this.phase === "over") {
      if (key === "r" || key === "enter") {
        e.preventDefault();
        this.restart();
      } else if (key === "escape") this.toMenu();
      return;
    }
    if (this.phase !== "playing") return;
    sfx.unlock();
    if (key === "escape") {
      if (this.strikeMode || this.sources.length || this.selArmy || this.inspect >= 0 || this.target >= 0) this.clearSel();
      else this.togglePause();
      return;
    }
    if (key === "p") {
      this.togglePause();
      return;
    }
    if (key === "m") {
      this.toggleMute();
      return;
    }
    if (this.paused) {
      if (key === "r") this.restart();
      if (key === "enter" || key === " ") {
        e.preventDefault();
        this.togglePause();
      }
      return;
    }
    switch (key) {
      case "tab":
        e.preventDefault();
        this.cycleCity(e.shiftKey ? -1 : 1);
        break;
      case "arrowup":
      case "arrowdown":
      case "arrowleft":
      case "arrowright":
        e.preventDefault();
        if (this.sources.length || this.selArmy) this.pickDir(key);
        else this.keys.add(key);
        break;
      case "backspace":
        this.target = -1;
        this.dirty();
        break;
      case "enter":
      case " ":
        e.preventDefault();
        this.kbSend();
        break;
      case "1":
      case "t":
        this.buyTank(e.shiftKey ? 5 : 1);
        break;
      case "2":
      case "b":
        this.strikeButton();
        break;
      case "q":
        this.cycleSendMode();
        break;
      case "c":
        this.centerCapital();
        break;
      case "f":
        this.fitView();
        break;
      case "+":
      case "=":
        this.r.zoomAt(this.r.vcx, this.r.vcy, 1.2);
        break;
      case "-":
      case "_":
        this.r.zoomAt(this.r.vcx, this.r.vcy, 1 / 1.2);
        break;
      case "w":
      case "a":
      case "s":
      case "d":
        this.keys.add(key);
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => {
    this.keys.clear();
  };

  private onVis = () => {
    if (document.hidden && this.kind === "local" && this.phase === "playing" && !this.paused) this.togglePause();
  };

  private onResize = () => {
    this.r.resize(window.innerWidth, window.innerHeight);
  };

  private panKeys(dt: number) {
    if (!this.keys.size || this.phase !== "playing") return;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx += 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx -= 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy -= 1;
    if (dx || dy) this.r.panBy(dx * 650 * dt, dy * 650 * dt);
  }

  private cycleCity(dir: number) {
    const s = this.state;
    if (!s || this.me < 0 || this.spectate) return;
    const own: number[] = [];
    for (let i = 0; i < s.cities.length; i++) if (s.cities[i].o === this.me) own.push(i);
    if (!own.length) return;
    own.sort((a, b) => s.map.cities[a].x - s.map.cities[b].x || s.map.cities[a].y - s.map.cities[b].y);
    const cur = this.sources.length ? own.indexOf(this.sources[0]) : -1;
    const n = own.length;
    const next = own[cur < 0 ? (dir > 0 ? 0 : n - 1) : (cur + dir + n) % n];
    this.sources = [next];
    this.selArmy = null;
    this.inspect = -1;
    this.target = -1;
    sfx.play("select");
    this.r.cityPulse(next, 0.3);
    this.ensureVisible(next);
    this.dirty();
  }

  private ensureVisible(ci: number) {
    const s = this.state;
    if (!s) return;
    const c = s.map.cities[ci];
    if (!this.r.onScreen(c.x, c.y, -70)) this.r.focus(c.x, c.y, this.r.cam.z);
  }

  private pickDir(key: string) {
    const s = this.state;
    if (!s) return;
    let from = this.sources[0];
    if (this.selArmy) {
      const a = s.armies.find((q) => q.id === this.selArmy);
      if (a) from = a.st === 2 || a.seg >= a.path.length - 1 ? a.path[a.seg] : a.path[a.seg + 1];
    }
    if (from === undefined) return;
    const base = this.target >= 0 ? this.target : from;
    const dir = key === "arrowup" ? [0, -1] : key === "arrowdown" ? [0, 1] : key === "arrowleft" ? [-1, 0] : [1, 0];
    const bc = s.map.cities[base];
    this.r.w2s(bc.x, bc.y);
    const bx = this.r.px;
    const by = this.r.py;
    let best = -1;
    let bs = -Infinity;
    for (const nb of s.map.cities[base].adj) {
      const c = s.map.cities[nb];
      this.r.w2s(c.x, c.y);
      const dx = this.r.px - bx;
      const dy = this.r.py - by;
      const L = Math.hypot(dx, dy) || 1;
      const dot = (dx * dir[0] + dy * dir[1]) / L;
      if (dot < 0.3) continue;
      const sc = dot * 2 - L / 600;
      if (sc > bs) {
        bs = sc;
        best = nb;
      }
    }
    if (best >= 0) {
      this.target = best === from ? -1 : best;
      sfx.play("click");
      this.ensureVisible(best);
      this.dirty();
    }
  }

  private kbSend() {
    if (this.target >= 0 && this.selArmy) {
      this.redirect(this.selArmy, this.target);
      return;
    }
    if (this.target >= 0 && this.sources.length) {
      const srcs = this.sources.filter((c) => c !== this.target);
      if (srcs.length) this.sendFrom(srcs, this.target, false);
      return;
    }
    if (!this.sources.length && !this.selArmy) this.cycleCity(1);
  }

  // ================================================================ per-frame logic

  private validateSel() {
    const s = this.state;
    if (!s || this.me < 0) return;
    if (this.sources.length && this.sources.some((c) => s.cities[c].o !== this.me)) {
      this.sources = this.sources.filter((c) => s.cities[c].o === this.me);
      this.dirty();
    }
    if (this.selArmy && !s.armies.some((a) => a.id === this.selArmy)) {
      this.selArmy = null;
      this.dirty();
    }
    const g = this.drag;
    if (g && g.kind === "send" && g.srcs.some((c) => s.cities[c].o !== this.me)) {
      g.srcs = g.srcs.filter((c) => s.cities[c].o === this.me);
      if (!g.srcs.length) this.drag = null;
    }
  }

  private updatePreview(now: number) {
    const s = this.state;
    if (!s || !this.canCommand() || this.strikeMode) {
      this.preview = null;
      return;
    }
    const g = this.drag;
    const dragging = !!g && g.moved && g.kind !== "pan";
    const srcs = dragging && g ? (g.kind === "send" ? g.srcs : []) : this.sources;
    const army = dragging && g ? (g.kind === "army" ? g.army : null) : this.selArmy;
    const tgt = dragging ? this.hoverCity : this.target >= 0 ? this.target : this.hoverCity;
    if (tgt < 0 || (!srcs.length && !army)) {
      this.preview = null;
      return;
    }
    const key = `${tgt}|${srcs.join(",")}|${army}|${this.sendMode}`;
    if (this.preview && this.preview.key === key && now - this.preview.at < 300) return;
    let path: number[] | null = null;
    let send = 0;
    if (army) {
      const a = s.armies.find((q) => q.id === army);
      if (!a) {
        this.preview = null;
        return;
      }
      const from = a.st === 2 || a.seg >= a.path.length - 1 ? a.path[a.seg] : a.path[a.seg + 1];
      path = findPath(s, from, tgt, this.me);
      send = armyPower(a);
    } else {
      const list = srcs.filter((c) => c !== tgt);
      if (!list.length) {
        this.preview = null;
        return;
      }
      path = findPath(s, list[0], tgt, this.me);
      for (const c of list) send += this.sendAmount(s.cities[c]);
    }
    if (!path || path.length < 2) {
      this.preview = null;
      return;
    }
    const end = path[path.length - 1];
    const ec = s.cities[end];
    const hostile = !(ec.o >= 0 && isAlly(s, ec.o, this.me));
    const def = hostile ? defenseOf(s, end) : 0;
    this.preview = { key, at: now, path, ok: hostile ? (send > def ? 1 : 2) : 0, send, def };
  }

  private view(): View | null {
    const s = this.state;
    if (!s) return null;
    const g = this.drag;
    const dragging = !!g && g.moved && g.kind !== "pan";
    return {
      state: s,
      me: this.kind === "demo" ? -1 : this.me,
      colors: this.colors,
      sources: dragging && g && g.kind === "send" ? g.srcs : this.sources,
      selArmy: dragging && g && g.kind === "army" ? g.army : this.selArmy,
      inspect: this.inspect,
      hoverCity: this.phase === "playing" ? this.hoverCity : -1,
      target: this.target,
      drag: dragging && g ? { x: g.x, y: g.y } : null,
      preview: this.preview,
      strikeMode: this.strikeMode,
      hint: this.phase === "playing" && !dragging ? this.hint : null,
      smooth: this.kind === "online",
      spectator: this.kind === "demo" || this.me < 0,
    };
  }

  private onScreen(x: number, y: number) {
    return this.r.onScreen(x, y, 40);
  }

  private col(o: number) {
    return o >= 0 ? this.colors[o] || K.COL_NEUTRAL : K.COL_NEUTRAL;
  }

  /** Diff-based juice: works identically for local sim and server snapshots. */
  private effects() {
    const s = this.state;
    if (!s) return;
    const r = this.r;
    const me = this.me;
    const demo = this.kind === "demo";
    const cs = s.map.cities;

    for (let i = 0; i < s.cities.length; i++) {
      const c = s.cities[i];
      const pw = cityPower(c);
      const pc = this.prevC[i];
      if (!pc) {
        this.prevC[i] = { o: c.o, p: pw };
        continue;
      }
      if (pc.o !== c.o) {
        const col = this.col(c.o);
        const mc = cs[i];
        r.cityPulse(i);
        r.ring(mc.x, mc.y, col, 8, 66, 0.7);
        r.ring(mc.x, mc.y, "#ffffff", 4, 40, 0.45);
        r.burst(mc.x, mc.y, col, demo ? 12 : 26, 190);
        r.smoke(mc.x, mc.y, 5, 10);
        if (!demo) {
          if (c.o === me) {
            sfx.play("capture");
            r.addShake(0.3);
            r.text(mc.x, mc.y + 4, "¡CAPTURADA!", "#ffffff", 13, 1.2);
          } else if (pc.o === me && me >= 0) {
            sfx.play("lost");
            r.addShake(0.5);
            r.flash("#ff1f3d", 0.28);
            r.text(mc.x, mc.y, "PERDIDA", "#ff4d5e", 15, 1.3);
          } else if (pc.o >= 0 && me >= 0 && isAlly(s, pc.o, me)) r.addShake(0.12);
          else if (this.onScreen(mc.x, mc.y)) r.addShake(0.06);
        }
      } else if (pw < pc.p) {
        const mc = cs[i];
        r.sparks(mc.x, mc.y, "#ffd27a", Math.min(6, (pc.p - pw) * 2));
        r.muzzle(mc.x, mc.y, 14);
        if (!demo && this.onScreen(mc.x, mc.y)) sfx.play("shot");
      }
      pc.o = c.o;
      pc.p = pw;
    }

    const now = r.time;
    const cur = this.cur;
    cur.clear();
    for (const a of s.armies) {
      cur.add(a.id);
      const pw = armyPower(a);
      const pa = this.prevA.get(a.id);
      if (!pa) {
        const back = this.gone.get(a.id);
        if (back === undefined || now - back > 0.8) {
          if (a.seg === 0 && a.p < 24) r.puff(a.x, a.y, this.col(a.o));
          if (!demo && me >= 0 && !isAlly(s, a.o, me)) {
            const tgt = a.path[a.path.length - 1];
            if (s.cities[tgt].o === me && now - this.lastThreat > 6) {
              this.lastThreat = now;
              this.toast(`¡Ataque enemigo hacia ${cs[tgt].name}!`, "bad");
              sfx.play("alert");
            }
          }
        }
        this.gone.delete(a.id);
        this.prevA.set(a.id, mkPrev(a));
        continue;
      }
      if (pw < pa.p) {
        r.sparks(a.x, a.y, this.col(a.o), Math.min(5, (pa.p - pw) * 2));
        r.muzzle(a.x, a.y, 10);
        if (!demo && this.onScreen(a.x, a.y)) sfx.play("shot");
      }
      pa.o = a.o;
      pa.p = pw;
      pa.x = a.x;
      pa.y = a.y;
      pa.st = a.st;
      pa.f = a.f;
      pa.n = a.path[a.seg];
      pa.dst = a.path[a.path.length - 1];
    }
    for (const [id, pa] of this.prevA) {
      if (cur.has(id)) continue;
      if (pa.f > 0 || pa.st === 2) {
        const captured = pa.st === 2 && s.cities[pa.n] && s.cities[pa.n].o === pa.o;
        if (!captured) {
          r.explode(pa.x, pa.y, Math.min(1.6, 0.6 + pa.p / 30));
          if (!demo && (pa.o === me || this.onScreen(pa.x, pa.y))) {
            r.addShake(pa.o === me ? 0.22 : 0.1);
            sfx.play("boom");
          }
        }
      } else {
        const dc = cs[pa.dst];
        if (dc && s.cities[pa.dst].o === pa.o) {
          r.ring(dc.x, dc.y, this.col(pa.o), 6, 30, 0.45);
          r.cityPulse(pa.dst, 0.35);
        }
      }
      this.gone.set(id, now);
      this.prevA.delete(id);
    }
    if (this.gone.size > 200) this.gone.clear();

    for (const k of s.strikes) {
      const prev = this.prevS.get(k.id);
      if (prev === undefined && !demo) sfx.play("plane");
      if (k.hit && prev !== true) {
        r.bigBoom(k.tx, k.ty);
        if (!demo) {
          r.addShake(0.65);
          r.flash("#fff1c1", 0.22);
          sfx.play("boom");
        } else r.addShake(0.08);
      }
      this.prevS.set(k.id, k.hit);
    }
    if (this.prevS.size > s.strikes.length) {
      for (const id of Array.from(this.prevS.keys())) if (!s.strikes.some((k) => k.id === id)) this.prevS.delete(id);
    }
  }

  private processEvents(st?: GameState | null) {
    const s = st ?? this.state;
    if (!s) return;
    if (this.kind === "demo") {
      this.lastEv = s.evSeq;
      return;
    }
    for (const e of s.events) {
      if (e.id <= this.lastEv) continue;
      this.lastEv = e.id;
      this.onEvent(s, e);
    }
  }

  private onEvent(s: GameState, e: GameEvent) {
    const me = this.me;
    const name = (i: number | undefined) => (i === undefined || i < 0 ? "Neutral" : i === me ? "Tú" : s.players[i]?.name ?? "?");
    switch (e.k) {
      case "cap": {
        const city = e.c !== undefined ? s.map.cities[e.c] : null;
        if (!city) break;
        if (e.o === me) {
          this.r.text(city.x, city.y - 14, `+${e.pts ?? 0}`, "#ffd166", 20, 1.3);
          if ((e.st ?? 0) >= 2) {
            this.toast(`¡RACHA x${e.st}! ${city.name}`, "gold");
            sfx.play("streak");
          }
          if (city.capital && e.f !== undefined && e.f >= 0) this.toast(`¡Capital de ${name(e.f)} conquistada!`, "good");
        } else if (e.f === me && me >= 0) {
          this.toast(`Has perdido ${city.name}`, "bad");
        } else if (city.capital && e.f !== undefined && e.f >= 0) {
          this.toast(`${name(e.o)} tomó la capital de ${name(e.f)}`, "info");
        }
        break;
      }
      case "elim":
        if (e.o === me) this.toast("Has sido eliminado", "bad");
        else this.toast(`${name(e.o)} ha sido eliminado`, me >= 0 && e.o !== undefined && isAlly(s, e.o, me) ? "bad" : "good");
        break;
      case "strike":
        if (e.f === me && me >= 0 && e.c !== undefined) this.toast(`¡Bombardeo sobre ${s.map.cities[e.c].name}!`, "bad");
        break;
      default:
        break;
    }
  }

  private checkGameOver() {
    const s = this.state;
    if (!s || this.phase !== "playing" || this.me < 0) return;
    const mp = s.players[this.me];
    if (s.over) this.finish();
    else if (!mp.alive && !this.spectate) this.finish();
  }

  private finish() {
    const s = this.state;
    if (!s) return;
    const mp = s.players[this.me];
    const win = s.over && s.winner >= 0 && mp.team === s.winner;
    const score = Math.floor(mp.score);
    let rank = this.result?.rank ?? 0;
    let newRecord = this.result?.newRecord ?? false;
    if (!this.resultSaved) {
      this.resultSaved = true;
      const res = saveLocalScore({
        name: mp.name,
        score,
        result: win ? "Victoria" : "Derrota",
        mode: this.modeLabel(),
        date: Date.now(),
        time: Math.round(s.time),
      });
      rank = res.rank;
      newRecord = res.newRecord;
      void fetch("/api/scores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: mp.name,
          score,
          result: win ? "Victoria" : "Derrota",
          mode: this.modeLabel(),
          online: this.kind === "online",
          durationSec: Math.round(s.time),
        }),
      }).catch(() => undefined);
    }
    if (win) {
      sfx.play("win");
      this.celebrate();
    } else {
      sfx.play("lose");
      this.r.addShake(0.45);
      this.r.flash("#ff1f3d", 0.3);
    }
    const winners = s.over && s.winner >= 0 ? s.players.filter((p) => p.team === s.winner).map((p) => p.name) : [];
    this.result = {
      win,
      over: s.over,
      score: Math.floor(mp.score),
      captures: mp.captures,
      kills: Math.floor(mp.kills),
      time: s.time,
      newRecord,
      rank,
      winners,
      title: win ? "VICTORIA" : s.over ? "DERROTA" : "ELIMINADO",
    };
    this.phase = "over";
    this.paused = false;
    this.hint = null;
    this.clearSel(false);
    this.dirty();
  }

  private celebrate() {
    const c = this.r.cam;
    for (let i = 0; i < 6; i++) {
      const x = c.x + (Math.random() - 0.5) * 520;
      const y = c.y + (Math.random() - 0.5) * 320;
      setTimeout(() => {
        if (!this.destroyed) this.r.confetti(x, y);
      }, i * 170);
    }
    this.r.flash("#ffffff", 0.25);
    this.r.addShake(0.3);
  }

  private toast(text: string, tone: Toast["tone"]) {
    this.toasts.push({ id: ++this.toastSeq, text, tone, until: performance.now() + 2800 });
    if (this.toasts.length > 4) this.toasts.shift();
    this.dirty();
  }

  private modeLabel() {
    if (this.kind === "online") {
      const m = this.lobby?.mode ?? this.state?.mode;
      return `Online · ${m === "teams" ? "Equipos" : "Todos contra todos"}`;
    }
    return `${MODE_LABEL[this.localOpts.mode]} · ${DIFF_LABEL[this.localOpts.diff]}`;
  }

  private selInfo(): SelInfo | null {
    const s = this.state;
    if (!s) return null;
    const me = this.me;
    if (this.selArmy) {
      const a = s.armies.find((q) => q.id === this.selArmy);
      if (!a) return null;
      const dest = s.map.cities[a.path[a.path.length - 1]];
      return {
        kind: "army",
        name: "Ejército",
        own: a.o === me,
        rel: 0,
        ownerName: s.players[a.o]?.name ?? "",
        ownerColor: this.col(a.o),
        level: 0,
        capital: false,
        inf: a.i,
        tanks: a.t,
        power: armyPower(a),
        multi: 1,
        dest: dest ? dest.name : "",
      };
    }
    const ci = this.sources.length ? this.sources[0] : this.inspect;
    if (ci < 0) return null;
    const c = s.cities[ci];
    const mc = s.map.cities[ci];
    let power = cityPower(c);
    if (this.sources.length > 1) power = this.sources.reduce((acc, x) => acc + cityPower(s.cities[x]), 0);
    return {
      kind: "city",
      name: mc.name,
      own: c.o === me,
      rel: c.o < 0 ? 3 : c.o === me ? 0 : me >= 0 && isAlly(s, c.o, me) ? 1 : 2,
      ownerName: c.o < 0 ? "Neutral" : s.players[c.o]?.name ?? "",
      ownerColor: this.col(c.o),
      level: mc.level,
      capital: mc.capital,
      inf: c.i,
      tanks: c.t,
      power,
      multi: this.sources.length,
      dest: "",
    };
  }

  private emitHud() {
    const s = this.state;
    const me = this.me;
    const playing = this.kind !== "demo" && !!s;
    const stats = playing && s ? playerStats(s) : [];
    const now = performance.now();
    if (this.toasts.some((t) => t.until <= now)) this.toasts = this.toasts.filter((t) => t.until > now);
    let players: HudPlayer[] = [];
    if (playing && s) {
      players = s.players.map((p, i) => ({
        idx: i,
        name: p.name,
        color: this.colors[i],
        rel: i === me ? 0 : me >= 0 && isAlly(s, i, me) ? 1 : 2,
        cities: stats[i].cities,
        power: stats[i].power,
        alive: p.alive,
        score: Math.floor(p.score),
        bot: p.bot,
        afk: p.afk,
        team: p.team,
      }));
      players.sort((a, b) => Number(b.alive) - Number(a.alive) || b.cities - a.cities || b.power - a.power);
    }
    const mp = playing && s && me >= 0 ? s.players[me] : null;
    hudStore.set({
      phase: this.phase,
      paused: this.paused,
      online: this.kind === "online",
      spectate: this.spectate,
      gold: mp ? Math.floor(mp.gold) : 0,
      income: mp ? Math.round(stats[me].income * 10) / 10 : 0,
      score: mp ? Math.floor(mp.score) : 0,
      streak: mp && s && s.time - mp.lastCapT <= K.STREAK_WINDOW && mp.streak > 1 ? mp.streak : 0,
      time: s ? s.time : 0,
      timeLimit: s ? s.timeLimit : 0,
      myCities: mp ? stats[me].cities : 0,
      totalCities: s ? s.cities.length : 0,
      players,
      sel: playing ? this.selInfo() : null,
      sendMode: this.sendMode,
      strikeCd: mp ? mp.strikeCd : 0,
      strikeMode: this.strikeMode,
      toasts: this.toasts.map(({ id, text, tone }) => ({ id, text, tone })),
      result: this.result,
      lobby: this.lobby,
      muted: sfx.muted,
      hint: !!this.hint && this.phase === "playing",
      error: this.error,
      alive: mp ? mp.alive : false,
      ping: this.net ? Math.round(this.net.rtt) : 0,
      modeLabel: this.modeLabel(),
      isHost: !!this.lobby && this.lobby.hostId === this.lobby.you,
      coarse: this.r.coarse,
    });
  }
}
