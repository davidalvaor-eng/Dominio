import { boolean, index, integer, jsonb, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Online rooms. The whole authoritative game state lives in `state` (jsonb) and is
 * advanced lazily (fixed-step) inside row-locked transactions on every client sync.
 */
export const rooms = pgTable(
  "rooms",
  {
    code: varchar("code", { length: 8 }).primaryKey(),
    name: varchar("name", { length: 40 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("lobby"), // lobby | playing | finished
    mode: varchar("mode", { length: 8 }).notNull().default("ffa"), // ffa | teams
    isPublic: boolean("is_public").notNull().default(true),
    maxPlayers: integer("max_players").notNull().default(4),
    hostId: varchar("host_id", { length: 32 }).notNull(),
    data: jsonb("data").notNull(), // lobby players, tokens, timers
    state: jsonb("state"), // GameState while playing
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("rooms_status_idx").on(t.status, t.updatedAt)],
);

/** Global leaderboard (local high scores live in localStorage). */
export const scores = pgTable(
  "scores",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 24 }).notNull(),
    score: integer("score").notNull(),
    result: varchar("result", { length: 12 }).notNull(),
    mode: varchar("mode", { length: 48 }).notNull(),
    online: boolean("online").notNull().default(false),
    durationSec: integer("duration_sec").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("scores_score_idx").on(t.score)],
);
