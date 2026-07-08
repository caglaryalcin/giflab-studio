export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "giflab-studio",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
