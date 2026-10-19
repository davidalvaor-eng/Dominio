"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Engine, Hud, SelInfo } from "@/game/engine";
import { STRIKE_CD, STRIKE_COST, TANK_COST } from "@/game/constants";
import { loadLocalScores, type LocalScore } from "@/game/highscores";
import { Icon, type IconName } from "./Icon";

type EngRef = RefObject<Engine | null>;

/** Smoothly counts toward `target` (cheap: only runs while the value changes). */
export function useTween(target: number, dur = 420) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    let raf = 0;
    const start = cur.current;
    if (start === target) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const f = Math.min(1, (now - t0) / dur);
      const val = Math.round(start + (target - start) * (1 - Math.pow(1 - f, 3)));
      cur.current = val;
      setV(val);
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="icon-btn panel">
      {children}
    </button>
  );
}

function Stat({ icon, value, sub, hot }: { icon: IconName; value: number; sub: string; hot?: boolean }) {
  return (
    <div className={`stat panel ${hot ? "border-amber-400/60 shadow-[0_0_18px_rgba(251,191,36,0.35)]" : ""}`}>
      <Icon name={icon} className={`h-5 w-5 sm:h-6 sm:w-6 ${icon === "coin" || hot ? "text-amber-300" : "text-sky-300"}`} />
      <div className="leading-none">
        <div className={`text-[15px] font-black tabular-nums sm:text-lg ${hot ? "text-amber-300" : "text-white"}`}>{value.toLocaleString("es")}</div>
        <div className={`mt-0.5 text-[9px] font-bold uppercase tracking-wider sm:text-[10px] ${hot ? "text-amber-300" : "text-sky-200/65"}`}>{sub}</div>
      </div>
    </div>
  );
}

function PlayersPanel({ hud }: { hud: Hud }) {
  const labels = ["TÚ", "ALIADO", "ENEMIGO"];
  return (
    <div className="panel pointer-events-auto absolute right-2 top-[58px] w-[min(15.5rem,calc(100vw-1rem))] rounded-xl p-2 sm:right-3 sm:top-[66px]">
      <div className="mb-1 flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-[0.2em] text-sky-200/60">
        <span>Comandantes</span>
        <span>Ciud · Fuerza</span>
      </div>
      <ul className="space-y-0.5">
        {hud.players.map((p) => (
          <li
            key={p.idx}
            className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs ${p.rel === 0 ? "bg-sky-400/10" : ""} ${p.alive ? "" : "opacity-40 line-through"}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {p.name}
              {p.afk && !p.bot ? <span className="ml-1 text-[9px] text-amber-300">(IA)</span> : null}
            </span>
            <span className={`rel rel-${p.rel}`}>{labels[p.rel]}</span>
            <span className="w-5 text-right font-bold tabular-nums">{p.cities}</span>
            <span className="w-8 text-right tabular-nums text-sky-200/70">{p.power}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-center justify-between border-t border-sky-400/10 px-1 pt-1.5 text-[10px] text-sky-200/55">
        <span className="truncate">{hud.modeLabel}</span>
        {hud.online ? <span className="shrink-0 text-emerald-300">● {hud.ping} ms</span> : null}
      </div>
    </div>
  );
}

function SelView({ sel }: { sel: SelInfo }) {
  const kind = sel.kind === "army" ? "Ejército" : sel.capital ? "Capital ★" : sel.level === 2 ? "Ciudad" : "Pueblo";
  const rel = ["Tuya", "Aliada", "Enemiga", "Neutral"][sel.rel] ?? "";
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      <div className="flex items-center gap-1.5 truncate text-sm font-bold text-white">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sel.ownerColor }} />
        <span className="truncate">{sel.multi > 1 ? `${sel.multi} ciudades` : sel.name}</span>
      </div>
      <div className="truncate text-[11px] text-sky-200/80">
        {kind} · {sel.kind === "army" ? `→ ${sel.dest}` : sel.rel === 0 ? rel : `${rel} · ${sel.ownerName}`}
      </div>
      <div className="truncate text-[11px] text-sky-200/60">
        ⚔ {sel.power} · {sel.inf} inf · {sel.tanks} tanq
      </div>
    </div>
  );
}

function ActionBtn(props: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  icon: IconName;
  label: string;
  cost?: number;
  sub?: string;
  k: string;
  cooldown?: number;
}) {
  const { onClick, disabled, active, icon, label, cost, sub, k, cooldown } = props;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`action-btn ${active ? "action-on" : ""}`}>
      {cooldown !== undefined && cooldown > 0 ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-sky-400/25" style={{ height: `${Math.min(1, cooldown) * 100}%` }} />
      ) : null}
      <Icon name={icon} className="relative h-5 w-5" />
      <span className="relative text-[10px] font-extrabold uppercase tracking-wide sm:text-[11px]">{label}</span>
      {cost !== undefined ? (
        <span className="relative text-[10px] font-bold text-amber-300">{cost} oro</span>
      ) : (
        <span className="relative text-[10px] text-sky-200/60">{sub}</span>
      )}
      <span className="kbd absolute right-1 top-1 hidden sm:block">{k}</span>
    </button>
  );
}

function ActionBar({ hud, engRef }: { hud: Hud; engRef: EngRef }) {
  const e = () => engRef.current;
  const sel = hud.sel;
  const strikeReady = hud.strikeCd <= 0;
  const modeLabels = ["50%", "100%", "Tanques"];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {hud.strikeMode ? (
        <div className="toast toast-gold pointer-events-auto flex items-center gap-2">
          <Icon name="plane" className="h-4 w-4" /> Elige una ciudad enemiga para el bombardeo
          <button type="button" className="underline" onClick={() => e()?.cancelStrike()}>
            Cancelar
          </button>
        </div>
      ) : hud.hint && !sel ? (
        <div className="hint-pill">
          {hud.coarse
            ? "Arrastra desde tu capital ★ hasta una ciudad vecina para atacar"
            : "Arrastra desde tu capital ★ (o clic en ella y clic en el objetivo) para atacar"}
        </div>
      ) : null}
      <div className="panel pointer-events-auto flex w-full max-w-2xl items-stretch gap-1.5 rounded-2xl p-1.5 sm:gap-2 sm:p-2">
        <div className="min-w-0 flex-1 px-1">
          {sel ? (
            <SelView sel={sel} />
          ) : (
            <div className="flex h-full flex-col justify-center leading-tight">
              <div className="text-sm font-bold text-white">Ordena a tus tropas</div>
              <div className="text-[11px] text-sky-200/70">
                {hud.coarse ? "Toca o arrastra desde tus ciudades" : "Tab · Flechas · Espacio · Clic derecho"}
              </div>
            </div>
          )}
        </div>
        <ActionBtn onClick={() => e()?.buyTank(1)} disabled={hud.gold < TANK_COST} icon="tank" label="Tanque" cost={TANK_COST} k="1" />
        <ActionBtn
          onClick={() => e()?.strikeButton()}
          disabled={!hud.strikeMode && (hud.gold < STRIKE_COST || !strikeReady)}
          active={hud.strikeMode}
          icon="plane"
          label={strikeReady ? "Bombardeo" : `${Math.ceil(hud.strikeCd)} s`}
          cost={STRIKE_COST}
          k="2"
          cooldown={hud.strikeCd / STRIKE_CD}
        />
        <ActionBtn onClick={() => e()?.cycleSendMode()} icon="send" label={modeLabels[hud.sendMode]} sub="Envío" k="Q" />
      </div>
    </div>
  );
}

export function HudLayer({ hud, engRef }: { hud: Hud; engRef: EngRef }) {
  const [showPlayers, setShowPlayers] = useState(false);
  useEffect(() => {
    setShowPlayers(window.innerWidth >= 900);
  }, []);
  const e = () => engRef.current;
  const score = useTween(hud.score);
  const remaining = Math.max(0, hud.timeLimit - hud.time);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="flex items-start justify-between gap-1.5 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-3">
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
          <Stat icon="coin" value={hud.gold} sub={`+${hud.income.toFixed(1)}/s`} />
          <Stat icon="star" value={score} sub={hud.streak > 1 ? `Racha x${hud.streak}` : "Puntos"} hot={hud.streak > 1} />
        </div>
        <div className="panel hidden flex-col items-center rounded-xl px-3 py-1 text-center min-[420px]:flex">
          <div className={`font-mono text-base font-bold tabular-nums sm:text-lg ${remaining < 30 ? "animate-pulse text-rose-300" : "text-white"}`}>
            {fmtTime(remaining)}
          </div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-sky-200/70 sm:text-[10px]">
            {hud.myCities}/{hud.totalCities} ciudades
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <IconBtn label="Centrar en mi capital (C)" onClick={() => e()?.centerCapital()}>
            <Icon name="target" />
          </IconBtn>
          <IconBtn label="Jugadores" onClick={() => setShowPlayers((v) => !v)}>
            <Icon name="users" />
          </IconBtn>
          <IconBtn label="Sonido (M)" onClick={() => e()?.toggleMute()}>
            <Icon name={hud.muted ? "mute" : "volume"} />
          </IconBtn>
          {hud.phase === "playing" ? (
            <IconBtn label="Pausa (P)" onClick={() => e()?.togglePause()}>
              <Icon name="pause" />
            </IconBtn>
          ) : null}
        </div>
      </div>

      <div className="absolute inset-x-0 top-[62px] flex flex-col items-center gap-1.5 px-2 sm:top-[72px]">
        {hud.toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>

      {showPlayers ? <PlayersPanel hud={hud} /> : null}

      {hud.phase === "playing" && !hud.spectate ? <ActionBar hud={hud} engRef={engRef} /> : null}
      {hud.phase === "playing" && hud.spectate ? (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="panel pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2 text-sm">
            <Icon name="eye" className="h-4 w-4 text-sky-300" /> Modo espectador
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Controls() {
  const rows: [string, string][] = [
    ["Arrastrar / Clic + Clic", "Enviar tropas"],
    ["Tab · Flechas · Espacio", "Elegir y atacar"],
    ["Q", "Modo de envío"],
    ["1 / 2", "Tanque / Bombardeo"],
    ["WASD · Rueda", "Cámara y zoom"],
    ["Esc · P · R · M", "Pausa · Reiniciar · Sonido"],
  ];
  return (
    <div className="mt-5 hidden grid-cols-2 gap-x-3 gap-y-1 text-left text-[11px] sm:grid">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="font-bold text-sky-100">{k}</span>
          <span className="text-sky-200/65">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function PauseOverlay({ hud, engRef, onMenu }: { hud: Hud; engRef: EngRef; onMenu: () => void }) {
  const e = () => engRef.current;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="panel pop-in w-full max-w-sm rounded-2xl p-6 text-center">
        <h2 className="title-glow text-4xl font-black tracking-[0.2em]">PAUSA</h2>
        {hud.online ? <p className="mt-2 text-sm text-amber-200">La partida online sigue en curso</p> : null}
        <div className="mt-5 space-y-2">
          <button type="button" className="btn btn-primary w-full py-3" onClick={() => e()?.togglePause()}>
            <Icon name="play" className="h-4 w-4" /> Continuar <span className="kbd">Esc</span>
          </button>
          {!hud.online ? (
            <button type="button" className="btn btn-ghost w-full" onClick={() => e()?.restart()}>
              <Icon name="restart" className="h-4 w-4" /> Reiniciar <span className="kbd">R</span>
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost w-full" onClick={() => e()?.toggleMute()}>
            <Icon name={hud.muted ? "mute" : "volume"} className="h-4 w-4" /> {hud.muted ? "Sonido desactivado" : "Sonido activado"}
          </button>
          <button type="button" className="btn btn-ghost w-full" onClick={onMenu}>
            <Icon name="home" className="h-4 w-4" /> Menú principal
          </button>
        </div>
        <Controls />
      </div>
    </div>
  );
}

export function GameOverOverlay({ hud, engRef, onMenu }: { hud: Hud; engRef: EngRef; onMenu: () => void }) {
  const r = hud.result;
  const e = () => engRef.current;
  const [top, setTop] = useState<LocalScore[]>([]);
  const [show, setShow] = useState(false);
  useEffect(() => {
    setTop(loadLocalScores().slice(0, 5));
  }, [r?.rank, r?.score]);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 450);
    return () => clearTimeout(t);
  }, []);
  const score = useTween(show ? r?.score ?? 0 : 0, 900);
  if (!r) return null;
  const canRestart = !hud.online || hud.isHost;
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-slate-950/55">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="panel pop-in w-full max-w-md rounded-2xl p-6 text-center">
          <div className={`text-5xl font-black tracking-[0.16em] sm:text-6xl ${r.win ? "title-win" : "title-lose"}`}>{r.title}</div>
          {!r.win && r.winners.length > 0 ? <p className="mt-1 text-sm text-sky-200/70">Ganan: {r.winners.join(", ")}</p> : null}
          {!r.over ? <p className="mt-1 text-sm text-sky-200/70">La batalla continúa sin ti…</p> : null}
          <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.3em] text-sky-200/60">Puntuación</div>
          <div className="text-5xl font-black tabular-nums text-amber-300">{score.toLocaleString("es")}</div>
          {r.newRecord ? (
            <div className="record-badge mt-2 inline-flex items-center gap-1.5">
              <Icon name="trophy" className="h-4 w-4" /> ¡NUEVO RÉCORD!
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Capturas", String(r.captures)],
              ["Bajas", String(r.kills)],
              ["Tiempo", fmtTime(r.time)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-sky-400/15 bg-slate-900/50 py-2">
                <div className="text-lg font-black tabular-nums text-white">{v}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-200/60">{k}</div>
              </div>
            ))}
          </div>
          {top.length ? (
            <div className="mt-4 text-left">
              <div className="label mb-1">Tus mejores partidas</div>
              <ol className="space-y-0.5">
                {top.map((s, i) => (
                  <li
                    key={`${s.date}-${i}`}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${r.rank === i + 1 ? "bg-amber-400/15 text-amber-100" : "text-sky-100/85"}`}
                  >
                    <span className="w-4 font-black text-sky-200/60">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className={s.result === "Victoria" ? "text-emerald-300" : "text-rose-300"}>{s.result}</span>
                    <span className="w-14 text-right font-bold tabular-nums">{s.score.toLocaleString("es")}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div className="mt-5 grid gap-2">
            {canRestart ? (
              <button type="button" className="btn btn-primary w-full py-3.5 text-base" onClick={() => e()?.restart()}>
                <Icon name="restart" className="h-5 w-5" /> {hud.online ? "Nueva partida" : "Revancha"} <span className="kbd">R</span>
              </button>
            ) : (
              <p className="text-xs text-sky-200/60">Esperando a que el anfitrión inicie otra partida…</p>
            )}
            {!r.over ? (
              <button type="button" className="btn btn-ghost w-full" onClick={() => e()?.spectateNow()}>
                <Icon name="eye" className="h-4 w-4" /> Seguir mirando
              </button>
            ) : null}
            {hud.online && hud.isHost ? (
              <button type="button" className="btn btn-ghost w-full" onClick={() => e()?.lobbyAction({ k: "lobby" })}>
                Volver a la sala
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost w-full" onClick={onMenu}>
              <Icon name="home" className="h-4 w-4" /> Menú
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
