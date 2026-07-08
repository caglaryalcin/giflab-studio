import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { findGifFileById } from "@/lib/gif-catalog";

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

  const fileStats = await stat(item.absolutePath);
  const stream = Readable.toWeb(createReadStream(item.absolutePath)) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(fileStats.size),
      "Cache-Control": "public, max-age=60",
    },
  });
}
