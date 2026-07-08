import { findGifFileById } from "@/lib/gif-catalog";
import { createGifPreview } from "@/lib/gif-variant";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const item = await findGifFileById(id);

  if (!item) {
    return new Response("Not found", { status: 404 });
  }

  let preview: Awaited<ReturnType<typeof createGifPreview>>;

  try {
    preview = await createGifPreview(item);
  } catch {
    return Response.json(
      { error: "Preview unavailable" },
      {
        status: 422,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return Response.json(preview, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
