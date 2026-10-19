"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Engine, hudStore, type LocalOpts } from "@/game/engine";
import { HelpScreen, LobbyScreen, MainMenu, OnlineMenu, ScoresScreen, type Screen } from "./Menus";
import { GameOverOverlay, HudLayer, PauseOverlay } from "./Hud";

const DEFAULT_PREFS: LocalOpts = { name: "", mode: "ffa", diff: "normal" };

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engRef = useRef<Engine | null>(null);
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.get, hudStore.get);
  const [screen, setScreen] = useState<Screen>("main");
  const [prefs, setPrefs] = useState<LocalOpts>(DEFAULT_PREFS);
  const [joinCode, setJoinCode] = useState("");
  const [resume, setResume] = useState<{ code: string; token: string } | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const eng = new Engine(cv);
    engRef.current = eng;
    eng.start();
    const dbg = window as unknown as { __dominio?: Engine };
    if (new URLSearchParams(window.location.search).has("debug")) dbg.__dominio = eng;
    return () => {
      eng.destroy();
      engRef.current = null;
      if (dbg.__dominio === eng) delete dbg.__dominio;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("dominio.prefs");
      if (raw) {
        const p = JSON.parse(raw) as Partial<LocalOpts>;
        setPrefs((d) => ({
          name: typeof p.name === "string" ? p.name.slice(0, 16) : d.name,
          mode: p.mode === "teams" || p.mode === "duel" || p.mode === "ffa" ? p.mode : d.mode,
          diff: p.diff === "easy" || p.diff === "hard" || p.diff === "normal" ? p.diff : d.diff,
        }));
      }
      const ses = sessionStorage.getItem("dominio.session");
      if (ses) {
        const s = JSON.parse(ses) as { code?: string; token?: string };
        if (s.code && s.token) setResume({ code: s.code, token: s.token });
      }
    } catch {
      /* ignore */
    }
    const sala = new URLSearchParams(window.location.search).get("sala");
    if (sala) {
      setJoinCode(sala.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
      setScreen("online");
    }
  }, []);

  const updatePrefs = useCallback((p: Partial<LocalOpts>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem("dominio.prefs", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const play = useCallback(() => {
    engRef.current?.startLocal({ ...prefs, name: prefs.name.trim() || "Comandante" });
  }, [prefs]);

  const joined = useCallback((code: string, token: string) => {
    setResume(null);
    engRef.current?.startOnline(code, token);
  }, []);

  const toMenu = useCallback(() => {
    engRef.current?.toMenu();
    setScreen("main");
  }, []);

  const back = useCallback(() => setScreen("main"), []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#040c16] text-slate-100">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="scan pointer-events-none absolute inset-0" />

      {hud.phase === "menu" ? (
        <>
          {screen === "main" ? (
            <MainMenu
              prefs={prefs}
              onPrefs={updatePrefs}
              onPlay={play}
              onGo={setScreen}
              resume={resume}
              onResume={() => {
                if (resume) joined(resume.code, resume.token);
              }}
              error={hud.error}
            />
          ) : null}
          {screen === "online" ? (
            <OnlineMenu name={prefs.name} onName={(name) => updatePrefs({ name })} initialCode={joinCode} onBack={back} onJoined={joined} />
          ) : null}
          {screen === "scores" ? <ScoresScreen onBack={back} /> : null}
          {screen === "help" ? <HelpScreen onBack={back} /> : null}
        </>
      ) : null}

      {hud.phase === "connecting" || hud.phase === "lobby" ? <LobbyScreen hud={hud} engRef={engRef} onLeave={toMenu} /> : null}

      {hud.phase === "playing" || hud.phase === "over" ? <HudLayer hud={hud} engRef={engRef} /> : null}
      {hud.phase === "playing" && hud.paused ? <PauseOverlay hud={hud} engRef={engRef} onMenu={toMenu} /> : null}
      {hud.phase === "over" ? <GameOverOverlay hud={hud} engRef={engRef} onMenu={toMenu} /> : null}
    </main>
  );
}
