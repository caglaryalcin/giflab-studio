import { findGifFileById } from "@/lib/gif-catalog";
import {
  createEditedGif,
  createEditorFileName,
  createGifVariant,
  createVariantFileName,
  isVariantId,
  isVariantMode,
} from "@/lib/gif-variant";
import type { GifEditorRequest } from "@/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const variantId = url.searchParams.get("variant") ?? "emerald";

  if (!isVariantMode(mode) || !isVariantId(variantId)) {
    return new Response("Invalid variant request", { status: 400 });
  }

  const item = await findGifFileById(id);
  if (!item) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const output = await createGifVariant(item, mode, variantId);
    const fileName = createVariantFileName(item.fileName, mode, variantId);
    const body = output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ) as ArrayBuffer;

    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(output.length),
        "Content-Type": "image/gif",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Variant export failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const item = await findGifFileById(id);

  if (!item) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const editorRequest = (await request.json()) as GifEditorRequest;
    const output = await createEditedGif(item, editorRequest);
    const fileName = createEditorFileName(item.fileName, editorRequest.stroke);
    const body = output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ) as ArrayBuffer;

    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(output.length),
        "Content-Type": "image/gif",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Variant export failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
