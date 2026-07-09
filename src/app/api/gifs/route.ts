import type { NextRequest } from "next/server";
import { getGifCatalog, refreshGifArchive } from "@/lib/gif-catalog";
import { startGifIndexJob } from "@/lib/gif-index-status";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";

  if (refresh) {
    const job = startGifIndexJob((reportProgress) => refreshGifArchive(reportProgress));
    void job.promise;
  }

  const response = await getGifCatalog({
    category: params.get("category") ?? undefined,
    query: params.get("query") ?? undefined,
    offset: parseInteger(params.get("offset")),
    limit: parseInteger(params.get("limit")),
  });

  return Response.json(response, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
