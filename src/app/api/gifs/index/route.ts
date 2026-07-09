import { getArchiveIndexCheckpointSummary, getArchiveIndexSummary, refreshGifArchive } from "@/lib/gif-catalog";
import {
  getLatestGifIndexStatus,
  isGifIndexPauseRequested,
  requestGifIndexPause,
  startGifIndexJob,
} from "@/lib/gif-index-status";
import type { GifIndexStatus, GifIndexSummary } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await createStatusResponse(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const action = await readAction(request);

  if (action === "pause") {
    requestGifIndexPause();
    const response = await createStatusResponse();

    return Response.json(
      {
        ...response,
        started: false,
      },
      {
        status: 202,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const job = startGifIndexJob((reportProgress) => refreshGifArchive(reportProgress, isGifIndexPauseRequested));
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

async function readAction(request: Request): Promise<string> {
  try {
    const payload = await request.json() as unknown;
    if (payload && typeof payload === "object" && "action" in payload) {
      const action = (payload as { action?: unknown }).action;
      return typeof action === "string" ? action : "";
    }
  } catch {
    return "";
  }

  return "";
}

async function createStatusResponse() {
  const [summary, status] = await Promise.all([
    getArchiveIndexSummary(),
    getLatestGifIndexStatus(),
  ]);
  const checkpoint = status.running ? null : await getArchiveIndexCheckpointSummary();

  return {
    status: normalizeIndexStatus(status, summary, checkpoint),
    summary,
  };
}

function normalizeIndexStatus(
  status: GifIndexStatus,
  summary: GifIndexSummary,
  checkpoint: Awaited<ReturnType<typeof getArchiveIndexCheckpointSummary>> | null,
): GifIndexStatus {
  if (status.running || status.phase === "paused" || status.phase === "error") {
    return status;
  }

  if (checkpoint?.exists) {
    return {
      ...status,
      currentPath: "",
      discoveredFiles: checkpoint.discoveredFiles,
      indexedFiles: checkpoint.indexedFiles,
      message: "Index paused",
      phase: "paused",
      progress: checkpoint.discoveredFiles > 0
        ? Math.min(99.5, Math.round((checkpoint.indexedFiles / checkpoint.discoveredFiles) * 1000) / 10)
        : 0,
      rootLabel: checkpoint.rootLabel,
      running: false,
      scannedDirectories: checkpoint.scannedDirectories,
      totalFiles: checkpoint.discoveredFiles,
      updatedAt: status.updatedAt || summary.scannedAt,
    };
  }

  if (!summary.exists) {
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
