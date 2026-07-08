import { findGifFileById } from "@/lib/gif-catalog";
import { createGifPoster } from "@/lib/gif-variant";

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

  let poster: Buffer;

  try {
    poster = await createGifPoster(item);
  } catch {
    return new Response("Poster unavailable", { status: 422 });
  }

  const body = poster.buffer.slice(
    poster.byteOffset,
    poster.byteOffset + poster.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Length": String(poster.length),
      "Content-Type": "image/png",
    },
  });
}
