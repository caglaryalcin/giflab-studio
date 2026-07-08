import { getArchiveIndexSummary, refreshGifArchive } from "@/lib/gif-catalog";
import { getGifIndexStatus, startGifIndexJob } from "@/lib/gif-index-status";

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
    Promise.resolve(getGifIndexStatus()),
  ]);

  return {
    status,
    summary,
  };
}
