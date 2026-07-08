import type { ArchiveIndexResult, ArchiveScanProgress } from "@/lib/gif-catalog";
import type { GifIndexStatus } from "@/types";

type GifIndexState = {
  promise: Promise<GifIndexStatus> | null;
  status: GifIndexStatus;
};

type GifIndexJob = (
  reportProgress: (progress: ArchiveScanProgress) => void,
) => Promise<ArchiveIndexResult>;

type GifIndexJobStart = {
  promise: Promise<GifIndexStatus>;
  started: boolean;
  status: GifIndexStatus;
};

const globalIndexState = globalThis as typeof globalThis & {
  __giflabIndexState?: GifIndexState;
};

const indexState = globalIndexState.__giflabIndexState ?? {
  promise: null,
  status: createIdleStatus(),
};

globalIndexState.__giflabIndexState = indexState;

export function getGifIndexStatus(): GifIndexStatus {
  return cloneStatus(indexState.status);
}

export function startGifIndexJob(job: GifIndexJob): GifIndexJobStart {
  if (indexState.promise) {
    return {
      promise: indexState.promise,
      started: false,
      status: getGifIndexStatus(),
    };
  }

  const startedAt = new Date().toISOString();
  setStatus({
    ...createIdleStatus(),
    message: "Preparing index",
    phase: "discovering",
    running: true,
    startedAt,
    updatedAt: startedAt,
  });

  const promise = job((progress) => {
    applyProgress(progress, startedAt);
  })
    .then((result) => {
      const now = new Date().toISOString();
      const status: GifIndexStatus = {
        ...indexState.status,
        completedAt: now,
        currentPath: "",
        discoveredFiles: result.count,
        durationMs: getDurationMs(startedAt, now),
        error: "",
        indexedFiles: result.count,
        message: `Indexed ${formatNumber(result.count)} GIFs`,
        pendingDirectories: 0,
        phase: "ready",
        progress: 100,
        rootLabel: result.rootLabel,
        running: false,
        totalFiles: result.count,
        updatedAt: now,
      };

      setStatus(status);
      return getGifIndexStatus();
    })
    .catch((error: unknown) => {
      const now = new Date().toISOString();
      const status: GifIndexStatus = {
        ...indexState.status,
        completedAt: now,
        durationMs: getDurationMs(startedAt, now),
        error: error instanceof Error ? error.message : "Indexing failed",
        message: "Indexing failed",
        phase: "error",
        running: false,
        updatedAt: now,
      };

      setStatus(status);
      return getGifIndexStatus();
    })
    .finally(() => {
      indexState.promise = null;
    });

  indexState.promise = promise;

  return {
    promise,
    started: true,
    status: getGifIndexStatus(),
  };
}

function applyProgress(progress: ArchiveScanProgress, startedAt: string): void {
  const now = new Date().toISOString();
  const progressValue =
    progress.totalFiles > 0
      ? Math.min(99.5, Math.round((progress.indexedFiles / progress.totalFiles) * 1000) / 10)
      : 0;

  setStatus({
    ...indexState.status,
    currentPath: progress.currentPath,
    discoveredFiles: progress.discoveredFiles,
    durationMs: getDurationMs(startedAt, now),
    error: "",
    indexedFiles: progress.indexedFiles,
    message: createProgressMessage(progress),
    pendingDirectories: progress.pendingDirectories,
    phase: progress.phase,
    progress: progress.phase === "writing" ? 99.5 : progressValue,
    rootLabel: progress.rootLabel,
    running: true,
    scannedDirectories: progress.scannedDirectories,
    startedAt,
    totalFiles: progress.totalFiles,
    updatedAt: now,
  });
}

function createProgressMessage(progress: ArchiveScanProgress): string {
  if (progress.phase === "discovering") {
    return `Found ${formatNumber(progress.discoveredFiles)} GIFs`;
  }

  if (progress.phase === "writing") {
    return "Writing catalog manifest";
  }

  return `Indexed ${formatNumber(progress.indexedFiles)} of ${formatNumber(progress.totalFiles)} GIFs`;
}

function createIdleStatus(): GifIndexStatus {
  return {
    completedAt: "",
    currentPath: "",
    discoveredFiles: 0,
    durationMs: 0,
    error: "",
    indexedFiles: 0,
    message: "Index is idle",
    pendingDirectories: 0,
    phase: "idle",
    progress: 0,
    rootLabel: "",
    running: false,
    scannedDirectories: 0,
    startedAt: "",
    totalFiles: 0,
    updatedAt: "",
  };
}

function cloneStatus(status: GifIndexStatus): GifIndexStatus {
  return { ...status };
}

function setStatus(status: GifIndexStatus): void {
  indexState.status = status;
}

function getDurationMs(startedAt: string, now: string): number {
  const started = Date.parse(startedAt);
  const updated = Date.parse(now);

  if (!Number.isFinite(started) || !Number.isFinite(updated)) return 0;
  return Math.max(0, updated - started);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
