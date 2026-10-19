export type Mode = "ffa" | "teams";
export type Difficulty = "easy" | "normal" | "hard";

export interface MapCity {
  id: number;
  name: string;
  x: number;
  y: number;
  level: 1 | 2 | 3; // 3 = capital
  capital: boolean;
  adj: number[];
}

export interface Road {
  a: number;
  b: number;
  len: number;
  sea: boolean;
}

export interface Blob {
  x: number;
  y: number;
  r: number;
}

export interface GameMap {
  w: number;
  h: number;
  seed: number;
  cities: MapCity[];
  roads: Road[];
  blobs: Blob[];
}

/** Dynamic city state. o = owner index (-1 neutral), i = infantry, t = tanks. */
export interface CityState {
  o: number;
  i: number;
  t: number;
  g: number; // growth accumulator
  d: number; // damage accumulator
}

export interface Army {
  id: string;
  o: number;
  i: number;
  t: number;
  path: number[]; // city ids
  seg: number; // current segment: path[seg] -> path[seg+1]
  p: number; // distance travelled on current segment
  st: 0 | 2; // 0 moving / idle, 2 sieging path[seg]
  d: number; // damage accumulator
  f: number; // number of enemy armies in melee range (computed each tick)
  x: number;
  y: number;
}

export interface Strike {
  id: string;
  o: number;
  city: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  hit: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  team: number;
  bot: boolean;
  diff: Difficulty;
  gold: number;
  score: number;
  alive: boolean;
  capital: number;
  strikeCd: number;
  kills: number;
  captures: number;
  lost: number;
  streak: number;
  lastCapT: number;
  think: number;
  seq: number; // last processed command sequence (online)
  seen: number; // last sync (ms epoch, online)
  afk: boolean;
  elimT: number;
}

export interface GameEvent {
  id: number;
  t: number;
  k: "cap" | "elim" | "strike" | "end";
  c?: number;
  o?: number;
  f?: number;
  pts?: number;
  st?: number;
  w?: number;
}

export interface GameState {
  map: GameMap;
  mode: Mode;
  time: number;
  timeLimit: number;
  cities: CityState[];
  armies: Army[];
  strikes: Strike[];
  players: PlayerState[];
  over: boolean;
  winner: number;
  nextId: number;
  events: GameEvent[];
  evSeq: number;
  rng: number;
}

export type Command =
  | { k: "send"; from: number[]; to: number; r: number; tk?: boolean; ids?: string[] }
  | { k: "redirect"; army: string; to: number }
  | { k: "tank"; city: number; n?: number }
  | { k: "strike"; city: number; id?: string };
