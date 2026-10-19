import { createRoom, listRooms, readJson } from "@/server/rooms";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ ok: true, rooms: await listRooms() });
  } catch {
    return Response.json({ ok: false, rooms: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await readJson(req);
  try {
    const r = await createRoom(body);
    return Response.json(r.body, { status: r.status });
  } catch {
    return Response.json({ ok: false, error: "No se pudo crear la sala" }, { status: 500 });
  }
}
