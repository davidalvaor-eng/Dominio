"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { Engine, Hud, LocalOpts } from "@/game/engine";
import type { LobbyAction } from "@/game/net";
import type { Difficulty } from "@/game/types";
import { bestLocalScore, loadLocalScores, type LocalScore } from "@/game/highscores";
import { COL_ENEMY, COL_ME, COL_SPECTATE } from "@/game/constants";
import { Icon, type IconName } from "./Icon";

export type Screen = "main" | "online" | "scores" | "help";
type EngRef = RefObject<Engine | null>;

function Seg<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg mt-1.5 grid" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={`seg-btn ${value === v ? "seg-on" : ""}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Logo() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-2 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.35em] text-sky-300/75">
        <span className="h-px w-8 bg-sky-400/40" />
        Guerra de ciudades
        <span className="h-px w-8 bg-sky-400/40" />
      </div>
      <h1 className="title-glow text-6xl font-black tracking-[0.14em] sm:text-7xl">DOMINIO</h1>
      <p className="mt-2 text-sm text-sky-100/75">Estrategia en tiempo real · Online · Aliados y enemigos en el mapa</p>
    </div>
  );
}

function Shell({ title, onBack, children, wide }: { title: string; onBack: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onBack]);
  return (
    <div className="menu-backdrop absolute inset-0 z-20 overflow-y-auto">
      <div className={`mx-auto flex min-h-full w-full ${wide ? "max-w-2xl" : "max-w-md"} flex-col justify-center px-4 py-8`}>
        <div className="panel pop-in rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black uppercase tracking-[0.15em] text-white">{title}</h2>
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={onBack}>
              ← Volver
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ main menu

export function MainMenu(props: {
  prefs: LocalOpts;
  onPrefs: (p: Partial<LocalOpts>) => void;
  onPlay: () => void;
  onGo: (s: Screen) => void;
  resume: { code: string; token: string } | null;
  onResume: () => void;
  error: string | null;
}) {
  const { prefs, onPrefs, onPlay, onGo, resume, onResume, error } = props;
  const [best, setBest] = useState(0);
  useEffect(() => {
    setBest(bestLocalScore());
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onPlay();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onPlay]);
  return (
    <div className="menu-backdrop absolute inset-0 z-20 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-8">
        <Logo />
        <div className="panel pop-in mt-6 rounded-2xl p-5">
          {error ? (
            <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
          ) : null}
          <label className="label" htmlFor="cmd-name">
            Nombre de comandante
          </label>
          <input
            id="cmd-name"
            className="field"
            value={prefs.name}
            maxLength={16}
            placeholder="Comandante"
            autoComplete="off"
            onChange={(e) => onPrefs({ name: e.target.value })}
          />
          <div className="mt-4">
            <span className="label">Modo</span>
            <Seg
              value={prefs.mode}
              onChange={(v) => onPrefs({ mode: v })}
              options={[
                ["ffa", "Todos vs todos"],
                ["teams", "Equipos 2v2"],
                ["duel", "Duelo 1v1"],
              ]}
            />
          </div>
          <div className="mt-3">
            <span className="label">Dificultad</span>
            <Seg
              value={prefs.diff}
              onChange={(v) => onPrefs({ diff: v })}
              options={[
                ["easy", "Fácil"],
                ["normal", "Normal"],
                ["hard", "Difícil"],
              ]}
            />
          </div>
          <button type="button" className="btn btn-primary mt-5 w-full py-4 text-lg" onClick={onPlay}>
            <Icon name="play" className="h-5 w-5" /> Jugar ahora <span className="kbd hidden sm:inline-block">Enter</span>
          </button>
          {resume ? (
            <button type="button" className="btn btn-ghost mt-2 w-full" onClick={onResume}>
              <Icon name="restart" className="h-4 w-4" /> Volver a la sala {resume.code}
            </button>
          ) : null}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" className="btn btn-ghost px-2" onClick={() => onGo("online")}>
              <Icon name="globe" className="h-4 w-4" /> Online
            </button>
            <button type="button" className="btn btn-ghost px-2" onClick={() => onGo("scores")}>
              <Icon name="trophy" className="h-4 w-4" /> Récords
            </button>
            <button type="button" className="btn btn-ghost px-2" onClick={() => onGo("help")}>
              <Icon name="help" className="h-4 w-4" /> Ayuda
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between px-1 text-xs text-sky-200/60">
          <span>
            Mejor puntuación: <b className="text-amber-300">{best.toLocaleString("es")}</b>
          </span>
          <span>Táctil · Ratón · Teclado</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ online

interface RoomInfo {
  code: string;
  name: string;
  status: string;
  mode: string;
  maxPlayers: number;
  humans: number;
}

export function OnlineMenu(props: {
  name: string;
  onName: (n: string) => void;
  initialCode: string;
  onBack: () => void;
  onJoined: (code: string, token: string) => void;
}) {
  const { name, onName, initialCode, onBack, onJoined } = props;
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"ffa" | "teams">("ffa");
  const [maxP, setMaxP] = useState(4);
  const [pub, setPub] = useState(true);
  const [diff, setDiff] = useState<Difficulty>("normal");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/rooms", { cache: "no-store" });
        const d = (await r.json()) as { rooms?: RoomInfo[] };
        if (alive && Array.isArray(d.rooms)) setRooms(d.rooms);
      } catch {
        /* offline */
      }
    };
    void load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const nm = name.trim() || "Comandante";
  const call = async (url: string, body: unknown) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { ok?: boolean; error?: string; code?: string; token?: string };
      if (!r.ok || !d.ok || !d.code || !d.token) throw new Error(d.error || "Error de conexión");
      onJoined(d.code, d.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de conexión");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Online" onBack={onBack}>
      <label className="label" htmlFor="on-name">
        Tu nombre
      </label>
      <input
        id="on-name"
        className="field"
        value={name}
        maxLength={16}
        placeholder="Comandante"
        autoComplete="off"
        onChange={(e) => onName(e.target.value)}
      />
      <button type="button" disabled={busy} className="btn btn-primary mt-4 w-full py-3.5" onClick={() => call("/api/quickmatch", { name: nm })}>
        <Icon name="bolt" className="h-5 w-5" /> Partida rápida
      </button>
      <p className="mt-1.5 text-center text-xs text-sky-200/60">Entra en una sala abierta o crea una. Empieza en 20 s y las plazas libres se llenan con bots.</p>

      <div className="divider">o</div>

      <div className="flex gap-2">
        <input
          className="field mt-0 flex-1 text-center font-black uppercase tracking-[0.3em]"
          value={code}
          maxLength={8}
          placeholder="CÓDIGO"
          autoComplete="off"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        />
        <button type="button" disabled={busy || code.length < 4} className="btn btn-ghost px-5" onClick={() => call(`/api/rooms/${code}/join`, { name: nm })}>
          Unirse
        </button>
      </div>

      <details className="mt-4 rounded-xl border border-sky-400/15 bg-sky-950/25 p-3">
        <summary className="cursor-pointer text-sm font-bold text-sky-100">Crear sala personalizada</summary>
        <div className="mt-3 space-y-3">
          <div>
            <span className="label">Modo</span>
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                ["ffa", "Todos vs todos"],
                ["teams", "Equipos"],
              ]}
            />
          </div>
          <div>
            <span className="label">Jugadores (bots completan)</span>
            <Seg
              value={maxP}
              onChange={setMaxP}
              options={[
                [2, "2"],
                [3, "3"],
                [4, "4"],
                [5, "5"],
                [6, "6"],
              ]}
            />
          </div>
          <div>
            <span className="label">Dificultad de bots</span>
            <Seg
              value={diff}
              onChange={setDiff}
              options={[
                ["easy", "Fácil"],
                ["normal", "Normal"],
                ["hard", "Difícil"],
              ]}
            />
          </div>
          <div>
            <span className="label">Visibilidad</span>
            <Seg
              value={pub ? "pub" : "priv"}
              onChange={(v) => setPub(v === "pub")}
              options={[
                ["pub", "Pública"],
                ["priv", "Privada (con código)"],
              ]}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            className="btn btn-primary w-full"
            onClick={() => call("/api/rooms", { playerName: nm, mode, maxPlayers: maxP, isPublic: pub, diff })}
          >
            Crear sala
          </button>
        </div>
      </details>

      <div className="mt-4">
        <div className="label mb-1.5">Salas públicas</div>
        {rooms.length === 0 ? (
          <p className="text-sm text-sky-200/50">No hay salas abiertas ahora mismo. ¡Crea una e invita a tus amigos!</p>
        ) : (
          <ul className="space-y-1.5">
            {rooms.map((r) => (
              <li key={r.code} className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/15 bg-slate-900/45 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{r.name}</div>
                  <div className="truncate text-xs text-sky-200/60">
                    {r.code} · {r.mode === "teams" ? "Equipos" : "Todos vs todos"} · {r.humans}/{r.maxPlayers} ·{" "}
                    {r.status === "playing" ? <span className="text-amber-300">En curso</span> : <span className="text-emerald-300">En sala</span>}
                  </div>
                </div>
                <button type="button" disabled={busy} className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => call(`/api/rooms/${r.code}/join`, { name: nm })}>
                  Entrar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {err ? <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{err}</p> : null}
    </Shell>
  );
}

// ------------------------------------------------------------------ lobby

export function LobbyScreen({ hud, engRef, onLeave }: { hud: Hud; engRef: EngRef; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const lobby = hud.lobby;
  const act = (a: LobbyAction) => engRef.current?.lobbyAction(a);
  if (!lobby) {
    return (
      <div className="menu-backdrop absolute inset-0 z-20 flex items-center justify-center p-4">
        <div className="panel pop-in rounded-2xl p-6 text-center">
          <div className="spinner mx-auto" />
          <p className="mt-3 font-semibold text-sky-100">Conectando con el cuartel general…</p>
          {hud.error ? <p className="mt-2 text-sm text-rose-300">{hud.error}</p> : null}
          <button type="button" className="btn btn-ghost mt-4" onClick={onLeave}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }
  const slots = Array.from({ length: Math.max(lobby.maxPlayers, lobby.players.length) }, (_, i) => lobby.players[i] ?? null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?sala=${lobby.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <Shell title="Sala de guerra" onBack={onLeave}>
      <div className="text-center">
        <div className="label">Código de sala</div>
        <div className="title-glow text-5xl font-black tracking-[0.3em]">{lobby.code}</div>
        <button type="button" className="btn btn-ghost mt-2 px-3 py-1.5 text-xs" onClick={copy}>
          <Icon name="link" className="h-3.5 w-3.5" /> {copied ? "Enlace copiado" : "Copiar invitación"}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        <span className="chip">{lobby.mode === "teams" ? "Equipos" : "Todos contra todos"}</span>
        <span className="chip">
          {lobby.players.length}/{lobby.maxPlayers} humanos
        </span>
        <span className="chip">{lobby.isPublic ? "Pública" : "Privada"}</span>
      </div>
      <ul className="mt-4 space-y-1.5">
        {slots.map((p, i) => {
          const col = p ? (lobby.mode === "teams" ? (p.team === 0 ? COL_ME : COL_ENEMY[0]) : COL_SPECTATE[i % COL_SPECTATE.length]) : "#334155";
          return (
            <li key={p ? p.id : `slot-${i}`} className="flex items-center gap-3 rounded-lg border border-sky-400/15 bg-slate-900/45 px-3 py-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: col, boxShadow: p ? `0 0 10px ${col}` : "none" }} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {p ? (
                  <span className="font-semibold text-white">{p.name}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sky-200/45">
                    <Icon name="bot" className="h-4 w-4" /> Bot (plaza libre)
                  </span>
                )}
                {p && p.id === lobby.you ? <span className="chip ml-2">Tú</span> : null}
                {p && p.id === lobby.hostId ? <span className="chip ml-1">Anfitrión</span> : null}
              </span>
              {p && lobby.mode === "teams" ? <span className="text-xs text-sky-200/70">Equipo {p.team === 0 ? "Azul" : "Rojo"}</span> : null}
              {p && !p.online ? <span className="text-xs text-amber-300">desconectado</span> : null}
            </li>
          );
        })}
      </ul>
      {lobby.autoStartIn > 0 ? (
        <p className="mt-3 text-center text-sm text-amber-200">
          La batalla empieza en <b className="tabular-nums">{lobby.autoStartIn} s</b> · las plazas libres serán bots
        </p>
      ) : null}
      {hud.isHost ? (
        <div className="mt-4 space-y-2">
          <Seg
            value={lobby.mode}
            onChange={(m) => act({ k: "mode", mode: m })}
            options={[
              ["ffa", "Todos vs todos"],
              ["teams", "Equipos"],
            ]}
          />
          <button type="button" className="btn btn-primary w-full py-3.5 text-base" onClick={() => act({ k: "start" })}>
            <Icon name="swords" className="h-5 w-5" /> Comenzar partida
          </button>
        </div>
      ) : (
        <p className="mt-4 text-center text-sm text-sky-200/70">Esperando a que el anfitrión inicie la partida…</p>
      )}
      {lobby.mode === "teams" ? (
        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => act({ k: "team" })}>
          <Icon name="swap" className="h-4 w-4" /> Cambiar de equipo
        </button>
      ) : null}
      {hud.error ? <p className="mt-2 text-center text-xs text-rose-300">{hud.error}</p> : null}
    </Shell>
  );
}

// ------------------------------------------------------------------ scores

interface GlobalScore {
  name: string;
  score: number;
  result: string;
  mode: string;
  online: boolean;
  durationSec: number;
}

function fmtDur(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ScoresScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"local" | "global">("local");
  const [local, setLocal] = useState<LocalScore[]>([]);
  const [global, setGlobal] = useState<GlobalScore[] | null>(null);
  useEffect(() => {
    setLocal(loadLocalScores());
  }, []);
  useEffect(() => {
    let alive = true;
    fetch("/api/scores", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { scores?: GlobalScore[] }) => {
        if (alive) setGlobal(Array.isArray(d.scores) ? d.scores : []);
      })
      .catch(() => {
        if (alive) setGlobal([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  const rows: { name: string; score: number; result: string; mode: string; time: number }[] =
    tab === "local"
      ? local.map((s) => ({ name: s.name, score: s.score, result: s.result, mode: s.mode, time: s.time }))
      : (global ?? []).map((s) => ({ name: s.name, score: s.score, result: s.result, mode: s.mode, time: s.durationSec }));
  return (
    <Shell title="Récords" onBack={onBack} wide>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ["local", "En este dispositivo"],
          ["global", "Ranking global"],
        ]}
      />
      <div className="mt-3">
        {tab === "global" && global === null ? (
          <div className="flex justify-center py-6">
            <div className="spinner" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-sky-200/55">Todavía no hay puntuaciones. ¡Juega una partida!</p>
        ) : (
          <ol className="space-y-1">
            {rows.map((s, i) => (
              <li
                key={`${s.name}-${s.score}-${i}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${i < 3 ? "border-amber-400/30 bg-amber-400/5" : "border-sky-400/10 bg-slate-900/40"}`}
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${
                    i === 0 ? "bg-amber-300 text-amber-950" : i === 1 ? "bg-slate-300 text-slate-900" : i === 2 ? "bg-orange-400 text-orange-950" : "text-sky-200/70"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-white">{s.name}</div>
                  <div className="truncate text-[11px] text-sky-200/55">
                    {s.mode} · {fmtDur(s.time)}
                  </div>
                </div>
                <span className={`text-xs font-bold ${s.result === "Victoria" ? "text-emerald-300" : "text-rose-300"}`}>{s.result}</span>
                <span className="w-16 text-right font-black tabular-nums text-amber-300">{s.score.toLocaleString("es")}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ help

export function HelpScreen({ onBack }: { onBack: () => void }) {
  const items: [IconName, string, string][] = [
    ["target", "Objetivo", "Conquista ciudades y elimina a los enemigos, o controla el 80% del mapa. Si se acaba el tiempo, gana quien tenga más ciudades."],
    ["city", "Ciudades", "Generan infantería y oro. Las capitales ★ producen más y defienden mejor. El número es la fuerza: infantería = 1, tanque = 3."],
    ["send", "Mover tropas", "Arrastra desde una ciudad tuya hasta otra (o toca origen y luego destino). Pasa por varias ciudades tuyas al arrastrar para atacar con todas a la vez."],
    ["swords", "Combate", "Los ejércitos enemigos que se cruzan luchan en el camino. Al llegar a una ciudad la asedian hasta tomarla. La etiqueta ✓/✗ predice el resultado."],
    ["tank", "Tanques", "12 de oro: refuerzan la ciudad seleccionada. Un ejército solo de tanques (modo «Tanques») se mueve mucho más rápido."],
    ["plane", "Bombardeo", "40 de oro: aviones que destruyen el 40% de una guarnición y dañan ejércitos cercanos. Recarga de 12 s."],
    ["users", "Aliados y enemigos", "Azul = tú · Verde = aliados · Rojo, naranja, rosa, amarillo = enemigos. Las rutas rojas parpadeantes son ataques contra ti."],
    ["star", "Puntos", "+50 ciudad neutral, +120 enemiga, +300 capital. Las rachas multiplican. +4 por cada baja enemiga y +1000 por victoria (+ bonus de tiempo)."],
    ["globe", "Online", "Partida rápida o sala con código. El servidor es autoritativo; si alguien se desconecta, la IA toma su ejército."],
  ];
  const keys: [string, string][] = [
    ["Tab / Shift+Tab", "Seleccionar tus ciudades"],
    ["Flechas", "Elegir objetivo vecino"],
    ["Espacio / Enter", "Enviar tropas"],
    ["Q", "Modo de envío 50% · 100% · Tanques"],
    ["1 / 2", "Comprar tanque / Bombardeo"],
    ["Clic derecho", "Enviar con la selección actual"],
    ["WASD · Rueda · +/-", "Mover cámara · Zoom"],
    ["C / F", "Centrar capital / Ver todo"],
    ["P / Esc", "Pausa"],
    ["R · M", "Reiniciar · Sonido"],
  ];
  return (
    <Shell title="Cómo jugar" onBack={onBack} wide>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map(([ic, t, d]) => (
          <div key={t} className="rounded-xl border border-sky-400/15 bg-slate-900/45 p-3">
            <div className="flex items-center gap-2 text-sm font-black text-white">
              <Icon name={ic} className="h-4 w-4 text-sky-300" />
              {t}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-sky-100/75">{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="label mb-1.5">Teclado</div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {keys.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 border-b border-sky-400/10 py-1">
              <span className="font-bold text-sky-100">{k}</span>
              <span className="text-right text-sky-200/65">{v}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-sky-200/60">Táctil: arrastra para enviar, desliza el mapa para moverte y pellizca para hacer zoom.</p>
      </div>
    </Shell>
  );
}
