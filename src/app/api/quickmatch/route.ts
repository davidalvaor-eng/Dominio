import { quickMatch, readJson } from "@/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson(req);
  try {
    const r = await quickMatch(body);
    return Response.json(r.body, { status: r.status });
  } catch {
    return Response.json({ ok: false, error: "No se pudo encontrar partida" }, { status: 500 });
  }
}
