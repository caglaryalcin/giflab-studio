import { findGifFileById } from "@/lib/gif-catalog";
import { analyzeGif } from "@/lib/gif-variant";

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

  let analysis: Awaited<ReturnType<typeof analyzeGif>>;

  try {
    analysis = await analyzeGif(item);
  } catch {
    return Response.json(
      { error: "Color analysis unavailable" },
      {
        status: 422,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return Response.json(analysis, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
