import { getArchiveIndexSummary, refreshGifArchive } from "@/lib/gif-catalog";
import { getLatestGifIndexStatus, startGifIndexJob } from "@/lib/gif-index-status";
import type { GifIndexStatus, GifIndexSummary } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await createStatusResponse(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST() {
  const job = startGifIndexJob((reportProgress) => refreshGifArchive(reportProgress));
  const response = await createStatusResponse();

  return Response.json(
    {
      ...response,
      started: job.started,
    },
    {
      status: job.started ? 202 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

async function createStatusResponse() {
  const [summary, status] = await Promise.all([
    getArchiveIndexSummary(),
    getLatestGifIndexStatus(),
  ]);

  return {
    status: normalizeIndexStatus(status, summary),
    summary,
  };
}

function normalizeIndexStatus(status: GifIndexStatus, summary: GifIndexSummary): GifIndexStatus {
  if (status.running || status.phase === "error" || !summary.exists) {
    return status;
  }

  return {
    ...status,
    completedAt: summary.scannedAt,
    currentPath: "",
    discoveredFiles: summary.count,
    indexedFiles: summary.count,
    message: `Indexed ${formatNumber(summary.count)} GIFs`,
    phase: "ready",
    progress: 100,
    rootLabel: summary.rootLabel,
    totalFiles: summary.count,
    updatedAt: summary.scannedAt,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
