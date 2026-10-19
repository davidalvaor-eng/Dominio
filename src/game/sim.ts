import type { Army, Command, Difficulty, GameEvent, GameState, Mode, Strike } from "./types";
import * as K from "./constants";
import { generateMap } from "./mapgen";

export interface NewPlayer {
  id: string;
  name: string;
  team: number;
  bot: boolean;
  diff: Difficulty;
}
export type AIFn = (s: GameState, pi: number) => void;

// ---------------------------------------------------------------- helpers

/** Deterministic RNG stored inside the state (server & client agree). */
export function rand(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function cityPower(c: { i: number; t: number }): number {
  return c.i + c.t * K.TANK_POWER;
}
export const armyPower = cityPower;

export function isAlly(s: GameState, a: number, b: number): boolean {
  if (a === b) return true;
  if (a < 0 || b < 0) return false;
  const pa = s.players[a];
  const pb = s.players[b];
  return !!pa && !!pb && pa.team === pb.team;
}

/** City owned by `o` or one of its allies. */
export function friendly(s: GameState, ci: number, o: number): boolean {
  const ow = s.cities[ci].o;
  return ow >= 0 && isAlly(s, ow, o);
}

export function defenseOf(s: GameState, ci: number): number {
  const c = s.cities[ci];
  return cityPower(c) * (c.o < 0 ? K.NEUTRAL_DEF : K.DEF[s.map.cities[ci].level]);
}

export function cityDist(s: GameState, a: number, b: number): number {
  const A = s.map.cities[a];
  const B = s.map.cities[b];
  return Math.hypot(B.x - A.x, B.y - A.y);
}

export function pathLength(s: GameState, path: number[]): number {
  let L = 0;
  for (let i = 0; i + 1 < path.length; i++) L += cityDist(s, path[i], path[i + 1]);
  return L;
}

function dps(power: number): number {
  return power > 0 ? K.MIN_DPS + K.DPS_FACTOR * Math.pow(power, K.DPS_EXP) : 0;
}

function dijkstra(s: GameState, from: number, owner: number, restricted: boolean) {
  const n = s.map.cities.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0) break;
    done[u] = true;
    const fr = u === from || friendly(s, u, owner);
    if (restricted && !fr) continue;
    const pen = fr ? 0 : 600;
    for (const v of s.map.cities[u].adj) {
      const w = best + cityDist(s, u, v) + pen;
      if (w < dist[v]) {
        dist[v] = w;
        prev[v] = u;
      }
    }
  }
  return { dist, prev };
}

/**
 * Road path for `owner`. Prefers routes through friendly territory. If the target lies
 * behind hostile cities, the path is truncated at the first hostile city (attack it first).
 */
export function findPath(s: GameState, from: number, to: number, owner: number): number[] | null {
  if (from === to) return [from];
  let r = dijkstra(s, from, owner, true);
  let restricted = true;
  if (!isFinite(r.dist[to])) {
    r = dijkstra(s, from, owner, false);
    restricted = false;
    if (!isFinite(r.dist[to])) return null;
  }
  const path: number[] = [];
  for (let v = to; v !== -1; v = r.prev[v]) path.push(v);
  path.reverse();
  if (!restricted) {
    for (let i = 1; i < path.length; i++) if (!friendly(s, path[i], owner)) return path.slice(0, i + 1);
  }
  return path;
}

export function nearestOwnCity(s: GameState, o: number, fromCity: number): number {
  let best = -1;
  let bd = Infinity;
  const A = s.map.cities[fromCity];
  for (let i = 0; i < s.cities.length; i++) {
    if (s.cities[i].o !== o) continue;
    const B = s.map.cities[i];
    const d = (A.x - B.x) ** 2 + (A.y - B.y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export function playerStats(s: GameState): { cities: number; power: number; income: number }[] {
  const st = s.players.map(() => ({ cities: 0, power: 0, income: 0 }));
  for (let i = 0; i < s.cities.length; i++) {
    const c = s.cities[i];
    if (c.o < 0 || !st[c.o]) continue;
    st[c.o].cities++;
    st[c.o].power += cityPower(c);
    st[c.o].income += K.INCOME[s.map.cities[i].level];
  }
  for (const a of s.armies) if (st[a.o]) st[a.o].power += armyPower(a);
  return st;
}

function pushEvent(s: GameState, e: Omit<GameEvent, "id" | "t">) {
  s.evSeq++;
  s.events.push({ ...e, id: s.evSeq, t: s.time });
  if (s.events.length > 24) s.events.splice(0, s.events.length - 24);
}

function credit(s: GameState, o: number, dmg: number) {
  if (o < 0 || dmg <= 0) return;
  const p = s.players[o];
  if (!p) return;
  p.kills += dmg;
  p.score += dmg * K.SCORE_KILL;
}

// ---------------------------------------------------------------- creation

export function createGame(seed: number, mode: Mode, players: NewPlayer[], timeLimit: number = K.TIME_LIMIT): GameState {
  const { map, capitals } = generateMap(seed, players.length);
  const s: GameState = {
    map,
    mode,
    time: 0,
    timeLimit,
    cities: [],
    armies: [],
    strikes: [],
    players: [],
    over: false,
    winner: -1,
    nextId: 1,
    events: [],
    evSeq: 0,
    rng: (seed ^ 0x9e3779b9) >>> 0,
  };
  s.cities = map.cities.map((c) => ({
    o: -1,
    i: c.level === 1 ? 4 + Math.floor(rand(s) * 5) : c.level === 2 ? 10 + Math.floor(rand(s) * 7) : 18,
    t: 0,
    g: 0,
    d: 0,
  }));
  players.forEach((p) => {
    s.players.push({
      id: p.id,
      name: p.name,
      team: p.team,
      bot: p.bot,
      diff: p.diff,
      gold: K.START_GOLD,
      score: 0,
      alive: true,
      capital: -1,
      strikeCd: 0,
      kills: 0,
      captures: 0,
      lost: 0,
      streak: 0,
      lastCapT: -99,
      think: 1.2 + rand(s) * 1.5,
      seq: 0,
      seen: 0,
      afk: false,
      elimT: -1,
    });
  });

  const order = players.map((_, i) => i);
  const caps = capitals.slice();
  if (mode === "teams") {
    caps.sort((a, b) => map.cities[a].x - map.cities[b].x);
    order.sort((a, b) => players[a].team - players[b].team || a - b);
  } else {
    for (let i = caps.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      const t = caps[i];
      caps[i] = caps[j];
      caps[j] = t;
    }
  }
  order.forEach((pi, k) => {
    let ci = caps[k];
    if (ci === undefined) ci = s.cities.findIndex((c) => c.o < 0);
    if (ci < 0) return;
    s.players[pi].capital = ci;
    const c = s.cities[ci];
    c.o = pi;
    c.i = K.START_INF;
    c.t = K.START_TANKS;
  });
  return s;
}

// ---------------------------------------------------------------- simulation

export function step(s: GameState, dt: number, aiFn?: AIFn): void {
  if (s.over || dt <= 0) return;
  s.time += dt;
  const P = s.players;
  const MC = s.map.cities;

  for (const p of P) if (p.strikeCd > 0) p.strikeCd = Math.max(0, p.strikeCd - dt);

  // economy & growth
  for (let ci = 0; ci < s.cities.length; ci++) {
    const c = s.cities[ci];
    if (c.o < 0) continue;
    const lv = MC[ci].level;
    const p = P[c.o];
    p.gold = Math.min(K.MAX_GOLD, p.gold + K.INCOME[lv] * dt);
    if (cityPower(c) < K.CAP[lv]) {
      c.g += dt / K.GROW[lv];
      if (c.g >= 1) {
        const n = Math.floor(c.g);
        c.i += n;
        c.g -= n;
      }
    } else c.g = 0;
  }

  detectFights(s);
  for (const a of s.armies) if (a.st === 0 && a.f === 0 && a.i + a.t > 0) moveArmy(s, a, dt);
  combat(s, dt);
  updateStrikes(s, dt);
  if (s.armies.some((a) => a.i + a.t <= 0)) s.armies = s.armies.filter((a) => a.i + a.t > 0);

  if (aiFn) {
    for (let pi = 0; pi < P.length; pi++) {
      const p = P[pi];
      if (p.alive && (p.bot || p.afk) && s.time >= p.think) {
        p.think = s.time + K.THINK[p.diff] * (0.7 + rand(s) * 0.6);
        aiFn(s, pi);
      }
    }
  }
  checkEnd(s);
}

function updatePos(s: GameState, a: Army) {
  const cs = s.map.cities;
  if (a.st === 2 || a.seg >= a.path.length - 1) {
    const c = cs[a.path[a.seg]];
    if (a.seg > 0) {
      const pv = cs[a.path[a.seg - 1]];
      const dx = pv.x - c.x;
      const dy = pv.y - c.y;
      const L = Math.hypot(dx, dy) || 1;
      a.x = c.x + (dx / L) * K.SIEGE_OFF;
      a.y = c.y + (dy / L) * K.SIEGE_OFF;
    } else {
      a.x = c.x + K.SIEGE_OFF;
      a.y = c.y;
    }
    return;
  }
  const A = cs[a.path[a.seg]];
  const B = cs[a.path[a.seg + 1]];
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const f = Math.min(1, a.p / L);
  a.x = A.x + (B.x - A.x) * f;
  a.y = A.y + (B.y - A.y) * f;
}

function moveArmy(s: GameState, a: Army, dt: number) {
  let rem = (a.i > 0 ? K.INF_SPEED : K.TANK_SPEED) * dt;
  let guard = 0;
  while (rem > 0 && a.st === 0 && a.seg < a.path.length - 1 && a.i + a.t > 0 && guard++ < 8) {
    const L = cityDist(s, a.path[a.seg], a.path[a.seg + 1]);
    const left = L - a.p;
    if (rem < left) {
      a.p += rem;
      rem = 0;
    } else {
      rem -= left;
      a.seg++;
      a.p = 0;
      arrive(s, a, a.path[a.seg]);
    }
  }
  updatePos(s, a);
}

function arrive(s: GameState, a: Army, node: number) {
  const c = s.cities[node];
  const last = a.seg >= a.path.length - 1;
  if (c.o === a.o) {
    if (last) {
      c.i += a.i;
      c.t += a.t;
      a.i = 0;
      a.t = 0;
    }
    return;
  }
  if (c.o >= 0 && isAlly(s, c.o, a.o)) {
    if (last) sendHome(s, a, node);
    return;
  }
  // hostile city: stop and besiege
  a.path = a.path.slice(0, a.seg + 1);
  a.st = 2;
  a.p = 0;
  updatePos(s, a);
  if (cityPower(c) <= 0) capture(s, node, a);
}

function sendHome(s: GameState, a: Army, node: number) {
  const home = nearestOwnCity(s, a.o, node);
  const path = home >= 0 ? findPath(s, node, home, a.o) : null;
  a.st = 0;
  a.p = 0;
  a.seg = 0;
  a.path = path && path.length > 1 ? path : [node];
}

function detectFights(s: GameState) {
  const A = s.armies;
  const R2 = K.FIGHT_R * K.FIGHT_R;
  for (const a of A) a.f = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    if (a.i + a.t <= 0) continue;
    for (let j = i + 1; j < A.length; j++) {
      const b = A[j];
      if (b.i + b.t <= 0 || isAlly(s, a.o, b.o)) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < R2) {
        a.f++;
        b.f++;
      }
    }
  }
}

function hurt(u: { i: number; t: number; d: number }, dmg: number) {
  u.d += dmg;
  while (u.d >= 1 && u.i > 0) {
    u.i--;
    u.d -= 1;
  }
  if (u.i === 0) {
    while (u.d >= K.TANK_POWER && u.t > 0) {
      u.t--;
      u.d -= K.TANK_POWER;
    }
  }
  if (u.i === 0 && u.t === 0) u.d = 0;
}

function combat(s: GameState, dt: number) {
  const A = s.armies;
  const n = A.length;
  if (!n) return;
  const R2 = K.FIGHT_R * K.FIGHT_R;
  const inc = new Float64Array(n);

  // field battles
  for (let i = 0; i < n; i++) {
    const a = A[i];
    if (!a.f) continue;
    for (let j = i + 1; j < n; j++) {
      const b = A[j];
      if (!b.f || isAlly(s, a.o, b.o)) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy >= R2) continue;
      const da = (dps(armyPower(a)) * dt) / a.f;
      const db = (dps(armyPower(b)) * dt) / b.f;
      inc[j] += da;
      inc[i] += db;
      credit(s, a.o, da);
      credit(s, b.o, db);
    }
  }

  // sieges
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = A[i];
    if (a.st !== 2 || a.f || a.i + a.t <= 0) continue;
    const ci = a.path[a.seg];
    let g = groups.get(ci);
    if (!g) {
      g = [];
      groups.set(ci, g);
    }
    g.push(i);
  }
  const cityInc = new Map<number, number>();
  for (const [ci, g] of groups) {
    const c = s.cities[ci];
    const lv = s.map.cities[ci].level;
    let total = 0;
    for (const i of g) total += armyPower(A[i]);
    for (const i of g) {
      const d = dps(armyPower(A[i])) * dt;
      cityInc.set(ci, (cityInc.get(ci) || 0) + d);
      credit(s, A[i].o, Math.min(d, cityPower(c)));
    }
    const cp = cityPower(c);
    if (cp > 0 && total > 0) {
      const out = dps(cp) * (c.o < 0 ? K.NEUTRAL_DEF : K.DEF[lv]) * dt;
      for (const i of g) {
        const share = (out * armyPower(A[i])) / total;
        inc[i] += share;
        credit(s, c.o, share);
      }
    }
  }

  for (let i = 0; i < n; i++) if (inc[i] > 0) hurt(A[i], inc[i]);
  for (const [ci, d] of cityInc) hurt(s.cities[ci], d);

  for (const [ci, g] of groups) {
    const c = s.cities[ci];
    if (cityPower(c) > 0) continue;
    let best: Army | null = null;
    for (const i of g) {
      const a = A[i];
      if (a.i + a.t > 0 && a.st === 2 && a.path[a.seg] === ci && (!best || armyPower(a) > armyPower(best))) best = a;
    }
    if (best) capture(s, ci, best);
  }
}

function capture(s: GameState, ci: number, a: Army) {
  const c = s.cities[ci];
  const prev = c.o;
  const mc = s.map.cities[ci];
  if (prev >= 0 && isAlly(s, prev, a.o)) {
    sendHome(s, a, ci);
    return;
  }
  c.o = a.o;
  c.i = a.i;
  c.t = a.t;
  c.d = 0;
  c.g = 0;
  a.i = 0;
  a.t = 0;
  const p = s.players[a.o];
  let pts = prev < 0 ? K.SCORE_NEUTRAL : mc.capital ? K.SCORE_CAPITAL : K.SCORE_CITY;
  p.streak = s.time - p.lastCapT <= K.STREAK_WINDOW ? Math.min(p.streak + 1, 5) : 1;
  p.lastCapT = s.time;
  pts = Math.round(pts * (1 + (p.streak - 1) * 0.5));
  p.score += pts;
  p.captures++;
  if (prev >= 0 && s.players[prev]) s.players[prev].lost++;
  pushEvent(s, { k: "cap", c: ci, o: a.o, f: prev, pts, st: p.streak });
  for (const b of s.armies) {
    if (b === a || b.i + b.t <= 0 || b.st !== 2 || b.path[b.seg] !== ci) continue;
    if (b.o === a.o) {
      c.i += b.i;
      c.t += b.t;
      b.i = 0;
      b.t = 0;
    } else if (isAlly(s, b.o, a.o)) sendHome(s, b, ci);
  }
}

function killFrac(u: { i: number; t: number; d: number }, frac: number, flat: number): number {
  const pw = cityPower(u);
  if (pw <= 0) return 0;
  let kill = Math.min(pw, Math.ceil(pw * frac) + flat);
  const dealt = kill;
  const ki = Math.min(u.i, kill);
  u.i -= ki;
  kill -= ki;
  if (kill > 0) u.t = Math.max(0, u.t - Math.ceil(kill / K.TANK_POWER));
  return dealt;
}

function updateStrikes(s: GameState, dt: number) {
  if (!s.strikes.length) return;
  for (const k of s.strikes) {
    k.t += dt;
    if (!k.hit && k.t >= k.dur) {
      k.hit = true;
      impact(s, k);
    }
  }
  s.strikes = s.strikes.filter((k) => k.t < k.dur + 1.6);
}

function impact(s: GameState, k: Strike) {
  let dealt = 0;
  const c = s.cities[k.city];
  if (!(c.o >= 0 && isAlly(s, c.o, k.o))) dealt += killFrac(c, K.STRIKE_FRAC, K.STRIKE_FLAT);
  const R2 = K.STRIKE_RADIUS * K.STRIKE_RADIUS;
  for (const a of s.armies) {
    if (a.i + a.t <= 0 || isAlly(s, a.o, k.o)) continue;
    const dx = a.x - k.tx;
    const dy = a.y - k.ty;
    if (dx * dx + dy * dy < R2) dealt += killFrac(a, K.STRIKE_FRAC, K.STRIKE_FLAT);
  }
  credit(s, k.o, dealt);
  pushEvent(s, { k: "strike", c: k.city, o: k.o, f: c.o });
}

function checkEnd(s: GameState) {
  const P = s.players;
  const alive = P.map(() => false);
  const teamCities = new Map<number, number>();
  const teamPower = new Map<number, number>();
  for (const c of s.cities) {
    if (c.o < 0) continue;
    alive[c.o] = true;
    const tm = P[c.o].team;
    teamCities.set(tm, (teamCities.get(tm) || 0) + 1);
    teamPower.set(tm, (teamPower.get(tm) || 0) + cityPower(c));
  }
  for (const a of s.armies) {
    if (a.i + a.t <= 0) continue;
    alive[a.o] = true;
    const tm = P[a.o].team;
    teamPower.set(tm, (teamPower.get(tm) || 0) + armyPower(a));
  }
  P.forEach((p, i) => {
    if (p.alive && !alive[i]) {
      p.alive = false;
      p.elimT = s.time;
      pushEvent(s, { k: "elim", o: i });
    }
  });
  const teams = new Set<number>();
  for (const p of P) if (p.alive) teams.add(p.team);
  if (teams.size <= 1) {
    finish(s, teams.size ? Array.from(teams)[0] : -1);
    return;
  }
  const total = s.cities.length;
  for (const [tm, n] of teamCities) {
    if (n >= total * K.DOMINATION) {
      finish(s, tm);
      return;
    }
  }
  if (s.time >= s.timeLimit) {
    let best = -1;
    let bc = -1;
    let bp = -1;
    for (const tm of teams) {
      const n = teamCities.get(tm) || 0;
      const pw = teamPower.get(tm) || 0;
      if (n > bc || (n === bc && pw > bp)) {
        best = tm;
        bc = n;
        bp = pw;
      }
    }
    finish(s, best);
  }
}

function finish(s: GameState, team: number) {
  s.over = true;
  s.winner = team;
  const bonus = K.SCORE_WIN + Math.max(0, Math.round((s.timeLimit - s.time) * 2));
  for (const p of s.players) if (p.team === team) p.score += bonus;
  pushEvent(s, { k: "end", w: team });
}

// ---------------------------------------------------------------- commands

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Validates and applies a player command. Safe to call with untrusted input. */
export function applyCommand(s: GameState, pi: number, cmd: Command): boolean {
  const p = s.players[pi];
  if (!p || !p.alive || s.over || !cmd || typeof cmd !== "object") return false;
  const n = s.cities.length;
  const validCity = (v: unknown): v is number => isInt(v) && v >= 0 && v < n;
  const hostileTarget = (ci: number) => {
    const o = s.cities[ci].o;
    return !(o >= 0 && o !== pi && isAlly(s, o, pi));
  };

  switch (cmd.k) {
    case "send": {
      if (!validCity(cmd.to) || !Array.isArray(cmd.from) || !hostileTarget(cmd.to)) return false;
      const r = typeof cmd.r === "number" && cmd.r > 0 ? Math.min(1, cmd.r) : 0.5;
      let ok = false;
      cmd.from.slice(0, 12).forEach((from, idx) => {
        if (!validCity(from) || from === cmd.to) return;
        const c = s.cities[from];
        if (c.o !== pi) return;
        let ni: number;
        let nt: number;
        if (cmd.tk) {
          ni = 0;
          nt = c.t;
        } else if (r >= 1) {
          ni = c.i;
          nt = c.t;
        } else {
          ni = Math.ceil(c.i * r);
          nt = Math.round(c.t * r);
        }
        if (ni + nt <= 0) return;
        const path = findPath(s, from, cmd.to, pi);
        if (!path || path.length < 2) return;
        c.i -= ni;
        c.t -= nt;
        const want = Array.isArray(cmd.ids) && typeof cmd.ids[idx] === "string" ? String(cmd.ids[idx]).slice(0, 32) : "";
        const id = want && !s.armies.some((a) => a.id === want) ? want : "a" + s.nextId++;
        const mc = s.map.cities[from];
        s.armies.push({ id, o: pi, i: ni, t: nt, path, seg: 0, p: 0, st: 0, d: 0, f: 0, x: mc.x, y: mc.y });
        ok = true;
      });
      return ok;
    }
    case "redirect": {
      if (!validCity(cmd.to) || typeof cmd.army !== "string" || !hostileTarget(cmd.to)) return false;
      const a = s.armies.find((x) => x.id === cmd.army);
      if (!a || a.o !== pi || a.i + a.t <= 0) return false;
      if (a.st === 2 || a.seg >= a.path.length - 1) {
        const node = a.path[a.seg];
        if (node === cmd.to) return false;
        const path = findPath(s, node, cmd.to, pi);
        if (!path || path.length < 2) return false;
        a.path = path;
        a.seg = 0;
        a.p = 0;
        a.st = 0;
        return true;
      }
      const A = a.path[a.seg];
      const B = a.path[a.seg + 1];
      const L = cityDist(s, A, B);
      const pB = findPath(s, B, cmd.to, pi);
      const pA = findPath(s, A, cmd.to, pi);
      const cB = pB ? L - a.p + pathLength(s, pB) : Infinity;
      const cA = pA ? a.p + pathLength(s, pA) : Infinity;
      if (!isFinite(cA) && !isFinite(cB)) return false;
      if (pB && cB <= cA) {
        a.path = [A, ...pB];
        a.seg = 0;
      } else if (pA) {
        a.path = [B, ...pA];
        a.seg = 0;
        a.p = Math.max(0, L - a.p);
      }
      return true;
    }
    case "tank": {
      if (!validCity(cmd.city)) return false;
      const c = s.cities[cmd.city];
      if (c.o !== pi) return false;
      const want = isInt(cmd.n) ? Math.max(1, Math.min(10, cmd.n)) : 1;
      const can = Math.min(want, Math.floor(p.gold / K.TANK_COST));
      if (can <= 0) return false;
      p.gold -= can * K.TANK_COST;
      c.t += can;
      return true;
    }
    case "strike": {
      if (!validCity(cmd.city) || p.gold < K.STRIKE_COST || p.strikeCd > 0) return false;
      const tc = s.cities[cmd.city];
      if (tc.o === pi || (tc.o >= 0 && isAlly(s, tc.o, pi))) return false;
      const from = nearestOwnCity(s, pi, cmd.city);
      if (from < 0) return false;
      const A = s.map.cities[from];
      const B = s.map.cities[cmd.city];
      const d = Math.hypot(B.x - A.x, B.y - A.y);
      const want = typeof cmd.id === "string" ? cmd.id.slice(0, 32) : "";
      const id = want && !s.strikes.some((k) => k.id === want) ? want : "s" + s.nextId++;
      p.gold -= K.STRIKE_COST;
      p.strikeCd = K.STRIKE_CD;
      s.strikes.push({ id, o: pi, city: cmd.city, fx: A.x, fy: A.y, tx: B.x, ty: B.y, t: 0, dur: 0.6 + d / K.STRIKE_SPEED, hit: false });
      return true;
    }
    default:
      return false;
  }
}
