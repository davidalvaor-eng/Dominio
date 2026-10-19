import { desc } from "drizzle-orm";
import { db } from "@/db";
import { scores } from "@/db/schema";
import { cleanText, readJson } from "@/server/rooms";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db
      .select({
        name: scores.name,
        score: scores.score,
        result: scores.result,
        mode: scores.mode,
        online: scores.online,
        durationSec: scores.durationSec,
        createdAt: scores.createdAt,
      })
      .from(scores)
      .orderBy(desc(scores.score), desc(scores.createdAt))
      .limit(20);
    return Response.json({ ok: true, scores: rows });
  } catch {
    return Response.json({ ok: false, scores: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const b = await readJson(req);
  const score = typeof b.score === "number" ? Math.floor(b.score) : NaN;
  if (!Number.isFinite(score) || score < 0 || score > 100000) {
    return Response.json({ ok: false, error: "Puntuación inválida" }, { status: 400 });
  }
  try {
    await db.insert(scores).values({
      name: cleanText(b.name, 16, "Comandante"),
      score,
      result: b.result === "Victoria" ? "Victoria" : "Derrota",
      mode: cleanText(b.mode, 48, "—"),
      online: b.online === true,
      durationSec: typeof b.durationSec === "number" ? Math.max(0, Math.min(36000, Math.floor(b.durationSec))) : 0,
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
