export interface LocalScore {
  name: string;
  score: number;
  result: string;
  mode: string;
  date: number;
  time: number;
}

const KEY = "dominio.highscores.v1";

export function loadLocalScores(): LocalScore[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is LocalScore => !!e && typeof e === "object" && typeof (e as LocalScore).score === "number");
  } catch {
    return [];
  }
}

export function bestLocalScore(): number {
  const l = loadLocalScores();
  return l.length ? l[0].score : 0;
}

/** Inserts the score, keeps the top 10 and returns its rank (0 = not in table). */
export function saveLocalScore(e: LocalScore): { rank: number; newRecord: boolean } {
  const list = loadLocalScores();
  const best = list.length ? list[0].score : 0;
  list.push(e);
  list.sort((a, b) => b.score - a.score || b.date - a.date);
  const top = list.slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(top));
  } catch {
    /* ignore */
  }
  const idx = top.indexOf(e);
  return { rank: idx >= 0 ? idx + 1 : 0, newRecord: e.score > 0 && e.score > best };
}
