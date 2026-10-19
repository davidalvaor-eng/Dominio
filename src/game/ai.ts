import type { GameState } from "./types";
import * as K from "./constants";
import { applyCommand, armyPower, cityDist, cityPower, defenseOf, friendly, isAlly, nearestOwnCity, rand } from "./sim";

/** Bot brain. Runs on the client for offline games and on the server for online rooms. */
export function runAI(s: GameState, pi: number): void {
  const p = s.players[pi];
  const MC = s.map.cities;
  const C = s.cities;
  const diff = p.diff;
  const need = diff === "hard" ? 1.15 : diff === "easy" ? 1.7 : 1.35;

  const own: number[] = [];
  for (let i = 0; i < C.length; i++) if (C[i].o === pi) own.push(i);

  const threat = new Array<number>(C.length).fill(0);
  const mine = new Array<number>(C.length).fill(0);
  for (const a of s.armies) {
    const tgt = a.path[a.path.length - 1];
    if (a.o === pi) mine[tgt] += armyPower(a);
    else if (!isAlly(s, a.o, pi) && C[tgt].o === pi) threat[tgt] += armyPower(a);
  }

  // idle or homeless armies
  for (const a of s.armies) {
    if (a.o !== pi || a.st !== 0 || a.seg < a.path.length - 1) continue;
    const node = a.path[a.seg];
    let target = nearestOwnCity(s, pi, node);
    if (target < 0) {
      let bv = Infinity;
      for (const nb of MC[node].adj) {
        if (friendly(s, nb, pi)) continue;
        const v = cityPower(C[nb]);
        if (v < bv) {
          bv = v;
          target = nb;
        }
      }
    }
    if (target >= 0 && target !== node) applyCommand(s, pi, { k: "redirect", army: a.id, to: target });
  }
  if (!own.length) return;

  const enemyAdj = (ci: number) => {
    let e = 0;
    for (const nb of MC[ci].adj) {
      const o = C[nb].o;
      if (o >= 0 && !isAlly(s, o, pi)) e += cityPower(C[nb]);
    }
    return e;
  };
  const isFrontier = (ci: number) => MC[ci].adj.some((nb) => !friendly(s, nb, pi));
  const frontier = own.filter(isFrontier);

  // 1) emergency defence
  for (const ci of own) {
    const def = defenseOf(s, ci);
    if (threat[ci] > def + mine[ci]) {
      for (const nb of MC[ci].adj) {
        if (C[nb].o !== pi || threat[nb] > 0) continue;
        if (cityPower(C[nb]) >= 6) applyCommand(s, pi, { k: "send", from: [nb], to: ci, r: 0.7 });
      }
    }
  }

  // 2) tanks
  const strikeReady = p.strikeCd <= 0;
  const reserve = strikeReady && diff !== "easy" && p.gold < K.STRIKE_COST + 25 ? K.STRIKE_COST : 0;
  if (frontier.length && p.gold >= K.TANK_COST + reserve && (diff !== "easy" || rand(s) < 0.5)) {
    let best = frontier[0];
    let bs = -Infinity;
    for (const ci of frontier) {
      const sc = threat[ci] * 2 + enemyAdj(ci) - cityPower(C[ci]) * 0.3 + (MC[ci].capital ? 10 : 0) + rand(s) * 4;
      if (sc > bs) {
        bs = sc;
        best = ci;
      }
    }
    const n = Math.min(diff === "hard" ? 5 : 3, Math.floor((p.gold - reserve) / K.TANK_COST));
    if (n > 0) applyCommand(s, pi, { k: "tank", city: best, n });
  }

  // 3) air strike on the strongest hostile neighbour
  if (strikeReady && p.gold >= K.STRIKE_COST && rand(s) < (diff === "easy" ? 0.15 : diff === "hard" ? 0.75 : 0.45)) {
    let best = -1;
    let bv = 12;
    for (const ci of frontier) {
      for (const nb of MC[ci].adj) {
        const o = C[nb].o;
        if (o < 0 || isAlly(s, o, pi)) continue;
        const v = cityPower(C[nb]) + (MC[nb].capital ? 8 : 0);
        if (v > bv) {
          bv = v;
          best = nb;
        }
      }
    }
    if (best >= 0) applyCommand(s, pi, { k: "strike", city: best });
  }

  // 4) attacks
  const tried = new Set<number>();
  const cands: { t: number; score: number; sources: number[]; def: number }[] = [];
  for (const ci of frontier) {
    for (const t of MC[ci].adj) {
      if (tried.has(t) || friendly(s, t, pi)) continue;
      tried.add(t);
      const tc = C[t];
      const lv = MC[t].level;
      const def = defenseOf(s, t) + (tc.o >= 0 ? 2 : 0);
      const sources = MC[t].adj.filter((nb) => C[nb].o === pi && cityPower(C[nb]) >= 3);
      if (!sources.length) continue;
      let avail = mine[t];
      for (const sc of sources) avail += cityPower(C[sc]) * (threat[sc] > 0 ? 0.4 : 0.85);
      if (avail < def * need + 1) continue;
      const value = (lv === 3 ? 5 : lv) * (tc.o < 0 ? 1.3 : 1) + (MC[t].capital && tc.o >= 0 ? 4 : 0);
      let dist = Infinity;
      for (const sc of sources) dist = Math.min(dist, cityDist(s, sc, t));
      cands.push({ t, score: (value / (def + 4) / (0.5 + dist / 400)) * (0.85 + rand(s) * 0.3), sources, def });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let attacks = diff === "hard" ? 3 : diff === "easy" ? 1 : 2;
  for (const c of cands) {
    if (attacks <= 0) break;
    if (mine[c.t] >= c.def * need + 1) continue;
    let avail = mine[c.t];
    for (const sc of c.sources) avail += cityPower(C[sc]) * (threat[sc] > 0 ? 0.4 : 0.85);
    if (avail < c.def * need + 1) continue;
    attacks--;
    for (const sc of c.sources) {
      if (cityPower(C[sc]) < 3) continue;
      applyCommand(s, pi, { k: "send", from: [sc], to: c.t, r: threat[sc] > 0 ? 0.4 : 0.85 });
    }
  }

  // 5) reinforce the front from the interior
  if (frontier.length && (diff !== "easy" || rand(s) < 0.5)) {
    for (const ci of own) {
      if (frontier.includes(ci) || cityPower(C[ci]) < (diff === "hard" ? 8 : 12)) continue;
      let best = -1;
      let bs = -Infinity;
      for (const f of frontier) {
        const sc = threat[f] * 2 + enemyAdj(f) + 10 - cityDist(s, ci, f) / 40;
        if (sc > bs) {
          bs = sc;
          best = f;
        }
      }
      if (best >= 0) applyCommand(s, pi, { k: "send", from: [ci], to: best, r: 0.8 });
    }
  }
}
