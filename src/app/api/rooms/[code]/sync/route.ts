import { readJson, syncRoom } from "@/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = await readJson(req);
  try {
    const r = await syncRoom(code, body);
    return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("sync error", e);
    return Response.json({ ok: false, error: "Error del servidor" }, { status: 500 });
  }
}
