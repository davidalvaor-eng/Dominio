// ---- World ----
export const WORLD_W = 1600;
export const WORLD_H = 1000;

// ---- Units ----
export const TANK_POWER = 3;
export const TANK_COST = 12;
export const INF_SPEED = 56; // world units / s
export const TANK_SPEED = 86; // tanks-only armies
export const FIGHT_R = 24;
export const SIEGE_OFF = 22;

// ---- Air strike ----
export const STRIKE_COST = 40;
export const STRIKE_CD = 12;
export const STRIKE_SPEED = 300;
export const STRIKE_RADIUS = 75;
export const STRIKE_FRAC = 0.4;
export const STRIKE_FLAT = 3;

// ---- Economy (index = city level) ----
export const INCOME = [0, 0.6, 1.1, 2.0];
export const GROW = [0, 2.4, 1.6, 0.95]; // seconds per infantry
export const CAP = [0, 25, 40, 70];
export const DEF = [0, 1.25, 1.4, 1.7];
export const NEUTRAL_DEF = 1.0;
export const START_GOLD = 20;
export const START_INF = 20;
export const START_TANKS = 1;
export const MAX_GOLD = 999;

// ---- Combat ----
export const DPS_FACTOR = 0.6;
export const DPS_EXP = 0.8; // sublinear: big stacks win, but not for free
export const MIN_DPS = 1.0;

// ---- Match ----
export const TIME_LIMIT = 420;
export const DOMINATION = 0.8;

// ---- Score ----
export const SCORE_NEUTRAL = 50;
export const SCORE_CITY = 120;
export const SCORE_CAPITAL = 300;
export const SCORE_KILL = 4;
export const SCORE_WIN = 1000;
export const STREAK_WINDOW = 6;

export const THINK: Record<"easy" | "normal" | "hard", number> = { easy: 2.8, normal: 1.9, hard: 1.25 };

// ---- Palette (relationship based: you / allies / enemies) ----
export const COL_ME = "#38bdf8";
export const COL_ALLY = ["#34d399", "#a3e635", "#2dd4bf", "#86efac"];
export const COL_ENEMY = ["#f43f5e", "#fb923c", "#e879f9", "#facc15", "#f87171"];
export const COL_SPECTATE = ["#38bdf8", "#f43f5e", "#34d399", "#fb923c", "#e879f9", "#facc15"];
export const COL_NEUTRAL = "#8193a8";
/** Ring colour around unit badges: 0 = you, 1 = ally, 2 = enemy, 3 = neutral */
export const REL_COL = ["#ffffff", "#22c55e", "#ef4444", "#94a3b8"];
