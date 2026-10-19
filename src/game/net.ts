import type { Command, GameMap, GameState, Mode } from "./types";

export interface LobbyPlayerInfo {
  id: string;
  name: string;
  team: number;
  online: boolean;
}

export interface SyncResponse {
  ok: boolean;
  error?: string;
  left?: boolean;
  code: string;
  name: string;
  status: "lobby" | "playing" | "finished";
  mode: Mode;
  maxPlayers: number;
  isPublic: boolean;
  hostId: string;
  you: string;
  gid: number;
  players: LobbyPlayerInfo[];
  autoStartIn: number;
  ack: number;
  state: Omit<GameState, "map"> | null;
  map?: GameMap;
}

export type LobbyAction =
  | { k: "start" }
  | { k: "mode"; mode: Mode }
  | { k: "team" }
  | { k: "restart" }
  | { k: "lobby" }
  | { k: "leave" };

/**
 * Polling sync client. Unacknowledged commands are re-sent until the server acks their
 * sequence number (idempotent), so lost packets never lose orders.
 */
export class NetClient {
  seq = 0;
  pending: { seq: number; cmd: Command }[] = [];
  inflight = false;
  lastAt = 0;
  interval = 900;
  rtt = 160;
  needMap = true;
  stopped = false;
  private action: LobbyAction | null = null;

  constructor(
    public readonly code: string,
    public readonly token: string,
    private readonly onData: (d: SyncResponse) => void,
    private readonly onFail: (msg: string, fatal: boolean) => void,
  ) {}

  queue(cmd: Command) {
    this.pending.push({ seq: ++this.seq, cmd });
    if (this.pending.length > 60) this.pending.splice(0, this.pending.length - 60);
    this.lastAt = 0;
  }

  act(a: LobbyAction) {
    this.action = a;
    this.lastAt = 0;
  }

  tick(now: number) {
    if (this.stopped || this.inflight || now - this.lastAt < this.interval) return;
    void this.send(now);
  }

  private async send(now: number) {
    this.inflight = true;
    this.lastAt = now;
    const action = this.action;
    this.action = null;
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(this.code)}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: this.token, cmds: this.pending, action, needMap: this.needMap }),
        cache: "no-store",
      });
      const d = (await res.json()) as SyncResponse;
      if (this.stopped) return;
      if (!res.ok || !d.ok) {
        const fatal = res.status === 404 || res.status === 403;
        if (fatal) this.stopped = true;
        this.onFail(d.error || "Error de conexión", fatal);
        return;
      }
      this.rtt = this.rtt * 0.75 + (performance.now() - t0) * 0.25;
      this.pending = this.pending.filter((p) => p.seq > d.ack);
      this.onData(d);
    } catch {
      if (action && !this.action) this.action = action;
      if (!this.stopped) this.onFail("Reconectando…", false);
    } finally {
      this.inflight = false;
    }
  }

  /** Fire-and-forget leave (used when quitting to menu). */
  leave() {
    this.stopped = true;
    try {
      void fetch(`/api/rooms/${encodeURIComponent(this.code)}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: this.token, action: { k: "leave" } }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }
}
