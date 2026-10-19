import { joinRoom, readJson } from "@/server/rooms";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = await readJson(req);
  try {
    const r = await joinRoom(code, body);
    return Response.json(r.body, { status: r.status });
  } catch {
    return Response.json({ ok: false, error: "No se pudo entrar en la sala" }, { status: 500 });
  }
}
