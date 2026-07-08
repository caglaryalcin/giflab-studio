import type { NextRequest } from "next/server";
import { getGifCatalog, refreshGifArchive } from "@/lib/gif-catalog";
import { startGifIndexJob } from "@/lib/gif-index-status";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";

  if (refresh) {
    const job = startGifIndexJob((reportProgress) => refreshGifArchive(reportProgress));
    const status = await job.promise;

    if (status.phase === "error") {
      return Response.json(
        { error: status.error || "Catalog refresh failed" },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  const response = await getGifCatalog({
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
