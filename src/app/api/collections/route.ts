import { readCollectionStore, writeCollectionStore } from "@/lib/collection-store";

export const runtime = "nodejs";

export async function GET() {
  const store = await readCollectionStore();

  return Response.json(store, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function PUT(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid collection payload" }, { status: 400 });
  }

  try {
    const store = await writeCollectionStore(payload);

    return Response.json(store, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Collection store could not be saved" }, { status: 500 });
  }
}
