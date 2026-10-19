import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { applyCommand, createGame, step, type NewPlayer } from "@/game/sim";
import { runAI } from "@/game/ai";
import type { Command, Difficulty, GameState, Mode } from "@/game/types";

export interface LobbyPlayer {
  id: string;
  name: string;
  token: string;
  team: number;
  seen: number;
}

export interface RoomData {
  players: LobbyPlayer[];
  gid: number;
  lastTick: number;
  autoStartAt: number;
  diff: Difficulty;
}

type Status = "lobby" | "playing" | "finished";
export type ApiResult = { status: number; body: Record<string, unknown> };

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_NAMES = ["Gral. Ramírez", "Mariscal Vega", "Cnel. Ortiz", "Alm. Rojas", "Cap. Duarte", "Gral. Navarro", "Cmdte. Ibarra"];
const STALE_LOBBY_MS = 20000;
const AFK_MS = 15000;
const MAX_CATCHUP_S = 8;
const STEP_S = 0.05;

const newToken = () => randomBytes(16).toString("hex");
const newId = () => randomBytes(6).toString("hex");
const newCode = () => Array.from(randomBytes(5), (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

export function cleanText(v: unknown, max: number, fallback: string): string {
  const s = typeof v === "string" ? v : "";
  const t = s
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return t || fallback;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

let lastCleanup = 0;
async function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;
  try {
    await db.delete(rooms).where(lt(rooms.updatedAt, new Date(now - 30 * 60000)));
  } catch {
    /* ignore */
  }
}

function startGame(data: RoomData, mode: Mode, maxPlayers: number, now: number): GameState {
  const humans = data.players;
  const total = Math.max(2, maxPlayers, humans.length);
  const players: NewPlayer[] = humans.map((h, i) => ({
    id: h.id,
    name: h.name,
    team: mode === "teams" ? h.team : i,
    bot: false,
    diff: data.diff,
  }));
  if (mode === "teams" && players.length >= 2 && players.length === total) {
    const t0 = players.filter((p) => p.team === 0).length;
    if (t0 === 0 || t0 === players.length) players[players.length - 1].team = 1 - players[0].team;
  }
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  for (let i = players.length; i < total; i++) {
    let team = i;
    if (mode === "teams") {
      const t0 = players.filter((p) => p.team === 0).length;
      team = t0 <= players.length - t0 ? 0 : 1;
    }
    players.push({ id: `bot-${i}-${newId().slice(0, 4)}`, name: names[i % names.length], team, bot: true, diff: data.diff });
  }
  data.gid += 1;
  data.lastTick = now;
  data.autoStartAt = 0;
  return createGame(Math.floor(Math.random() * 2147483647), mode, players);
}

export async function createRoom(input: Record<string, unknown>): Promise<ApiResult> {
  await cleanup();
  const mode: Mode = input.mode === "teams" ? "teams" : "ffa";
  let maxPlayers = typeof input.maxPlayers === "number" && Number.isFinite(input.maxPlayers) ? Math.round(input.maxPlayers) : 4;
  maxPlayers = Math.max(2, Math.min(6, maxPlayers));
  if (mode === "teams" && maxPlayers % 2) maxPlayers += 1;
  const diff: Difficulty = input.diff === "easy" || input.diff === "hard" ? input.diff : "normal";
  const now = Date.now();
  const me: LobbyPlayer = { id: newId(), name: cleanText(input.playerName, 16, "Comandante"), token: newToken(), team: 0, seen: now };
  const data: RoomData = { players: [me], gid: 0, lastTick: now, autoStartAt: input.quick === true ? now + 20000 : 0, diff };
  const name = cleanText(input.roomName, 28, `Sala de ${me.name}`);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    try {
      await db.insert(rooms).values({
        code,
        name,
        status: "lobby",
        mode,
        isPublic: input.isPublic !== false,
        maxPlayers,
        hostId: me.id,
        data,
        state: null,
      });
      return { status: 200, body: { ok: true, code, token: me.token, playerId: me.id } };
    } catch (e) {
      if (attempt === 5) throw e;
    }
  }
  return { status: 500, body: { ok: false, error: "No se pudo crear la sala" } };
}

export async function joinRoom(codeRaw: string, input: Record<string, unknown>): Promise<ApiResult> {
  const code = normCode(codeRaw);
  if (code.length < 4) return { status: 404, body: { ok: false, error: "Código inválido" } };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(rooms).where(eq(rooms.code, code)).for("update");
    if (!row) return { status: 404, body: { ok: false, error: "La sala no existe" } };
    const data = row.data as RoomData;
    const now = Date.now();
    const me: LobbyPlayer = { id: newId(), name: cleanText(input.name, 16, "Comandante"), token: newToken(), team: 0, seen: now };
    const state = row.state as GameState | null;
    if (row.status === "lobby") {
      data.players = data.players.filter((p) => now - p.seen < STALE_LOBBY_MS);
      if (data.players.length >= row.maxPlayers) return { status: 409, body: { ok: false, error: "La sala está llena" } };
      if (row.mode === "teams") {
        const t0 = data.players.filter((p) => p.team === 0).length;
        me.team = t0 <= data.players.length - t0 ? 0 : 1;
      }
      data.players.push(me);
      const hostId = data.players.some((p) => p.id === row.hostId) ? row.hostId : data.players[0].id;
      await tx.update(rooms).set({ data, hostId, updatedAt: new Date() }).where(eq(rooms.code, code));
    } else if (row.status === "playing" && state) {
      if (state.time > 180) return { status: 409, body: { ok: false, error: "La partida está demasiado avanzada" } };
      const slot = state.players.findIndex((p) => p.bot && p.alive);
      if (slot < 0) return { status: 409, body: { ok: false, error: "No quedan plazas libres" } };
      const sp = state.players[slot];
      sp.id = me.id;
      sp.name = me.name;
      sp.bot = false;
      sp.afk = false;
      sp.seen = now;
      sp.seq = 0;
      me.team = sp.team;
      data.players.push(me);
      await tx.update(rooms).set({ data, state, updatedAt: new Date() }).where(eq(rooms.code, code));
    } else {
      return { status: 409, body: { ok: false, error: "La partida ya terminó" } };
    }
    return { status: 200, body: { ok: true, code, token: me.token, playerId: me.id } };
  });
}

/**
 * The heart of online play: lock the room row, advance the authoritative simulation to
 * "now" in fixed steps (bots included), apply this player's queued commands, persist.
 */
export async function syncRoom(codeRaw: string, body: Record<string, unknown>): Promise<ApiResult> {
  const code = normCode(codeRaw);
  const tok = typeof body.token === "string" ? body.token : "";
  if (!tok) return { status: 403, body: { ok: false, error: "Token inválido" } };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(rooms).where(eq(rooms.code, code)).for("update");
    if (!row) return { status: 404, body: { ok: false, error: "La sala ya no existe" } };
    const data = row.data as RoomData;
    const me = data.players.find((p) => p.token === tok);
    if (!me) return { status: 403, body: { ok: false, error: "Ya no perteneces a esta sala" } };
    const now = Date.now();
    me.seen = now;
    let status = (row.status as Status) || "lobby";
    let state = row.state as GameState | null;
    let mode: Mode = row.mode === "teams" ? "teams" : "ffa";
    let hostId = row.hostId;
    if (status === "lobby") data.players = data.players.filter((p) => p === me || now - p.seen < STALE_LOBBY_MS);
    if (!data.players.some((p) => p.id === hostId)) hostId = data.players[0].id;
    const isHost = me.id === hostId;

    const a = body.action && typeof body.action === "object" ? (body.action as { k?: unknown; mode?: unknown }) : null;
    if (a) {
      switch (a.k) {
        case "start":
          if (isHost && status === "lobby") {
            state = startGame(data, mode, row.maxPlayers, now);
            status = "playing";
          }
          break;
        case "mode":
          if (isHost && status === "lobby") {
            mode = a.mode === "teams" ? "teams" : "ffa";
            if (mode === "teams") data.players.forEach((p, i) => (p.team = i % 2));
          }
          break;
        case "team":
          if (status === "lobby" && mode === "teams") me.team = me.team === 0 ? 1 : 0;
          break;
        case "restart":
          if (isHost && status !== "lobby") {
            state = startGame(data, mode, row.maxPlayers, now);
            status = "playing";
          }
          break;
        case "lobby":
          if (isHost && status !== "lobby") {
            status = "lobby";
            state = null;
            data.autoStartAt = 0;
          }
          break;
        case "leave": {
          data.players = data.players.filter((p) => p !== me);
          if (state) {
            const sp = state.players.find((p) => p.id === me.id);
            if (sp) {
              sp.afk = true;
              sp.seen = 0;
            }
          }
          if (!data.players.length) {
            await tx.delete(rooms).where(eq(rooms.code, code));
            return { status: 200, body: { ok: true, left: true } };
          }
          if (hostId === me.id) hostId = data.players[0].id;
          await tx.update(rooms).set({ data, state, hostId, updatedAt: new Date() }).where(eq(rooms.code, code));
          return { status: 200, body: { ok: true, left: true } };
        }
        default:
          break;
      }
    }

    if (status === "lobby" && data.autoStartAt > 0 && now >= data.autoStartAt) {
      state = startGame(data, mode, row.maxPlayers, now);
      status = "playing";
    }

    let ack = 0;
    if (status !== "lobby" && state) {
      const idx = state.players.findIndex((p) => p.id === me.id);
      if (idx >= 0) {
        state.players[idx].seen = now;
        state.players[idx].afk = false;
      }
      if (status === "playing") {
        let dt = Math.min(MAX_CATCHUP_S, Math.max(0, (now - data.lastTick) / 1000));
        while (dt > 1e-6) {
          const d = Math.min(STEP_S, dt);
          step(state, d, runAI);
          dt -= d;
        }
        data.lastTick = now;
        for (const p of state.players) if (!p.bot && !p.afk && now - p.seen > AFK_MS) p.afk = true;
      }
      if (idx >= 0 && Array.isArray(body.cmds)) {
        const sp = state.players[idx];
        for (const raw of body.cmds.slice(0, 40)) {
          const pc = raw as { seq?: unknown; cmd?: unknown } | null;
          if (!pc || typeof pc.seq !== "number" || pc.seq <= sp.seq) continue;
          sp.seq = pc.seq;
          try {
            applyCommand(state, idx, pc.cmd as Command);
          } catch {
            /* ignore malformed */
          }
        }
      }
      if (state.over) status = "finished";
      if (idx >= 0) ack = state.players[idx].seq;
    }

    await tx
      .update(rooms)
      .set({ data, state, status, mode, hostId, version: row.version + 1, updatedAt: new Date() })
      .where(eq(rooms.code, code));

    const withState = status !== "lobby" && state;
    return {
      status: 200,
      body: {
        ok: true,
        code,
        name: row.name,
        status,
        mode,
        maxPlayers: row.maxPlayers,
        isPublic: row.isPublic,
        hostId,
        you: me.id,
        gid: data.gid,
        players: data.players.map((p) => ({ id: p.id, name: p.name, team: p.team, online: now - p.seen < 12000 })),
        autoStartIn: status === "lobby" && data.autoStartAt > 0 ? Math.max(0, Math.ceil((data.autoStartAt - now) / 1000)) : 0,
        ack,
        state: withState ? { ...withState, map: undefined } : null,
        map: withState && body.needMap === true ? withState.map : undefined,
      },
    };
  });
}

export interface RoomListItem {
  code: string;
  name: string;
  status: string;
  mode: string;
  maxPlayers: number;
  humans: number;
}

export async function listRooms(): Promise<RoomListItem[]> {
  const since = new Date(Date.now() - 60000);
  const rows = await db
    .select({
      code: rooms.code,
      name: rooms.name,
      status: rooms.status,
      mode: rooms.mode,
      maxPlayers: rooms.maxPlayers,
      data: rooms.data,
    })
    .from(rooms)
    .where(and(eq(rooms.isPublic, true), gt(rooms.updatedAt, since), inArray(rooms.status, ["lobby", "playing"])))
    .orderBy(desc(rooms.updatedAt))
    .limit(20);
  const now = Date.now();
  return rows.map((r) => {
    const d = r.data as RoomData;
    return {
      code: r.code,
      name: r.name,
      status: r.status,
      mode: r.mode,
      maxPlayers: r.maxPlayers,
      humans: (d.players || []).filter((p) => now - p.seen < STALE_LOBBY_MS).length,
    };
  });
}

export async function quickMatch(input: Record<string, unknown>): Promise<ApiResult> {
  const list = await listRooms();
  for (const r of list.filter((x) => x.status === "lobby" && x.humans > 0 && x.humans < x.maxPlayers)) {
    const res = await joinRoom(r.code, input);
    if (res.status === 200) return res;
  }
  for (const r of list.filter((x) => x.status === "playing" && x.humans > 0)) {
    const res = await joinRoom(r.code, input);
    if (res.status === 200) return res;
  }
  return createRoom({ playerName: input.name, mode: "ffa", maxPlayers: 4, isPublic: true, quick: true });
}
