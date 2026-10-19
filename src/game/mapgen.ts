import type { Blob, GameMap, MapCity, Road } from "./types";
import { WORLD_H, WORLD_W } from "./constants";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  "Valdoria", "Puerto Sol", "Monteluz", "Ríoseco", "Altamar", "Bahía Gris", "Fuerte Ámbar", "Villanova",
  "Santa Brisa", "Los Cedros", "Peñarroja", "Torreblanca", "Cumbre Fría", "Arenales", "Esperanza", "Valle Oscuro",
  "San Telmo", "Marisma", "Roca Negra", "Puerto Viejo", "Campoverde", "Lunaria", "El Paso", "Ciudad Hierro",
  "Mirador", "Aguasclaras", "Sierra Azul", "Olivar", "Bastión", "Cruz del Sur", "Ventisca", "Robledo",
  "Medina", "Costa Rota", "Palmira", "Escarcha", "Portobelo", "Llanura", "Zafra", "Cerro Gordo",
  "Isla Lobo", "Tres Ríos",
];

/** Deterministic procedural map: Mitchell sampled cities, Gabriel-graph roads, blob land masses. */
export function generateMap(seed: number, nPlayers: number): { map: GameMap; capitals: number[] } {
  const R = mulberry32(seed);
  const W = WORLD_W;
  const H = WORLD_H;
  const M = 90;
  const n = Math.max(16, Math.min(40, 12 + nPlayers * 5));

  // --- cities (best-candidate sampling) ---
  const pts: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    let bx = 0;
    let by = 0;
    let bd = -1;
    for (let c = 0; c < 32; c++) {
      const x = M + R() * (W - 2 * M);
      const y = M + R() * (H - 2 * M);
      let d = Infinity;
      for (const p of pts) {
        const dx = p.x - x;
        const dy = p.y - y;
        const dd = dx * dx + dy * dy;
        if (dd < d) d = dd;
      }
      if (d > bd) {
        bd = d;
        bx = x;
        by = y;
      }
    }
    pts.push({ x: Math.round(bx), y: Math.round(by) });
  }

  // --- roads: Gabriel graph + MST guarantee ---
  const cand: { a: number; b: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = pts[i];
      const B = pts[j];
      const mx = (A.x + B.x) / 2;
      const my = (A.y + B.y) / 2;
      const dx = A.x - B.x;
      const dy = A.y - B.y;
      const r2 = (dx * dx + dy * dy) / 4;
      let ok = true;
      for (let q = 0; q < n; q++) {
        if (q === i || q === j) continue;
        const ex = pts[q].x - mx;
        const ey = pts[q].y - my;
        if (ex * ex + ey * ey <= r2) {
          ok = false;
          break;
        }
      }
      if (ok) cand.push({ a: i, b: j, len: Math.sqrt(dx * dx + dy * dy) });
    }
  }
  cand.sort((p, q) => p.len - q.len);
  const parent = pts.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const deg = new Array<number>(n).fill(0);
  const roads: Road[] = [];
  for (const e of cand) {
    const ra = find(e.a);
    const rb = find(e.b);
    const mst = ra !== rb;
    if (mst) parent[ra] = rb;
    if (mst || (e.len < 290 && deg[e.a] < 5 && deg[e.b] < 5)) {
      roads.push({ a: e.a, b: e.b, len: Math.round(e.len), sea: false });
      deg[e.a]++;
      deg[e.b]++;
    }
  }
  for (const r of roads) if (r.len > 215 && R() < 0.5) r.sea = true;

  // --- capitals: farthest point sampling ---
  const cx = W / 2;
  const cy = H / 2;
  const caps: number[] = [];
  let first = 0;
  let fd = -1;
  for (let i = 0; i < n; i++) {
    if (deg[i] < 2) continue;
    const d = (pts[i].x - cx) ** 2 + ((pts[i].y - cy) * 1.6) ** 2 + R() * 4000;
    if (d > fd) {
      fd = d;
      first = i;
    }
  }
  caps.push(first);
  for (let pass = 0; pass < 2 && caps.length < nPlayers; pass++) {
    while (caps.length < nPlayers) {
      let bi = -1;
      let bd = -1;
      for (let i = 0; i < n; i++) {
        if (caps.includes(i) || (pass === 0 && deg[i] < 2)) continue;
        let d = Infinity;
        for (const c of caps) {
          const dx = pts[i].x - pts[c].x;
          const dy = pts[i].y - pts[c].y;
          d = Math.min(d, dx * dx + dy * dy);
        }
        if (d > bd) {
          bd = d;
          bi = i;
        }
      }
      if (bi < 0) break;
      caps.push(bi);
    }
  }

  // --- names / adjacency / levels ---
  const names = NAMES.slice();
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    const t = names[i];
    names[i] = names[j];
    names[j] = t;
  }
  const adj: number[][] = pts.map(() => []);
  for (const r of roads) {
    adj[r.a].push(r.b);
    adj[r.b].push(r.a);
  }
  const capSet = new Set(caps);
  const nearCap = new Set<number>();
  for (const c of caps) for (const a of adj[c]) nearCap.add(a);

  const cities: MapCity[] = pts.map((p, i) => {
    const level: 1 | 2 | 3 = capSet.has(i) ? 3 : !nearCap.has(i) && R() < 0.34 ? 2 : 1;
    return {
      id: i,
      name: names[i % names.length] + (i >= names.length ? " " + (Math.floor(i / names.length) + 1) : ""),
      x: p.x,
      y: p.y,
      level,
      capital: capSet.has(i),
      adj: adj[i],
    };
  });

  // --- land blobs (union of circles rendered once into a cache) ---
  const blobs: Blob[] = [];
  for (const p of pts) {
    blobs.push({ x: p.x, y: p.y, r: Math.round(66 + R() * 30) });
    for (let q = 0; q < 3; q++) {
      const a = R() * Math.PI * 2;
      const d = 35 + R() * 65;
      blobs.push({
        x: Math.round(p.x + Math.cos(a) * d),
        y: Math.round(p.y + Math.sin(a) * d),
        r: Math.round(30 + R() * 42),
      });
    }
  }
  for (const r of roads) {
    if (r.sea) continue;
    const A = pts[r.a];
    const B = pts[r.b];
    const steps = Math.ceil(r.len / 36);
    const L = r.len || 1;
    const nx = -(B.y - A.y) / L;
    const ny = (B.x - A.x) / L;
    for (let q = 1; q < steps; q++) {
      const f = q / steps;
      const w = (R() - 0.5) * 44;
      blobs.push({
        x: Math.round(A.x + (B.x - A.x) * f + nx * w),
        y: Math.round(A.y + (B.y - A.y) * f + ny * w),
        r: Math.round(36 + R() * 26),
      });
    }
  }

  return { map: { w: W, h: H, seed, cities, roads, blobs }, capitals: caps };
}
