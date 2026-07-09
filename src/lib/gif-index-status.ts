import { readFile } from "node:fs/promises";
import type { ArchiveIndexResult, ArchiveScanProgress } from "@/lib/gif-catalog";
import { getGifCacheFile, writeCacheFile } from "@/lib/gif-cache";
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

const statusSnapshotStaleMs = 30000;

const indexState = globalIndexState.__giflabIndexState ?? {
  promise: null,
  status: createIdleStatus(),
};

globalIndexState.__giflabIndexState = indexState;

export function getGifIndexStatus(): GifIndexStatus {
  return cloneStatus(indexState.status);
}

export async function getLatestGifIndexStatus(): Promise<GifIndexStatus> {
  const memoryStatus = getGifIndexStatus();
  const persistedStatus = await readPersistedStatus();

  if (!persistedStatus) return memoryStatus;
  if (isRunningStatusStale(persistedStatus)) return memoryStatus;

  return isStatusNewer(persistedStatus, memoryStatus) ? persistedStatus : memoryStatus;
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

  if (progress.phase === "warming") {
    return `Prepared ${formatNumber(progress.indexedFiles)} of ${formatNumber(progress.totalFiles)} posters`;
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
  void writePersistedStatus(status);
}

async function readPersistedStatus(): Promise<GifIndexStatus | null> {
  try {
    return parsePersistedStatus(await readFile(getStatusSnapshotPath(), "utf8"));
  } catch {
    return null;
  }
}

async function writePersistedStatus(status: GifIndexStatus): Promise<void> {
  try {
    await writeCacheFile(getStatusSnapshotPath(), JSON.stringify(status));
  } catch {
    // Live status is best-effort; indexing should continue even when the cache is read-only.
  }
}

function getStatusSnapshotPath(): string {
  return getGifCacheFile("status", "archive-index", "json");
}

function parsePersistedStatus(raw: string): GifIndexStatus | null {
  const value = JSON.parse(raw) as unknown;

  if (!isRecord(value)) return null;

  const status: GifIndexStatus = {
    completedAt: readString(value.completedAt),
    currentPath: readString(value.currentPath),
    discoveredFiles: readNumber(value.discoveredFiles),
    durationMs: readNumber(value.durationMs),
    error: readString(value.error),
    indexedFiles: readNumber(value.indexedFiles),
    message: readString(value.message),
    pendingDirectories: readNumber(value.pendingDirectories),
    phase: readPhase(value.phase),
    progress: readNumber(value.progress),
    rootLabel: readString(value.rootLabel),
    running: value.running === true,
    scannedDirectories: readNumber(value.scannedDirectories),
    startedAt: readString(value.startedAt),
    totalFiles: readNumber(value.totalFiles),
    updatedAt: readString(value.updatedAt),
  };

  return status.message ? status : null;
}

function isStatusNewer(candidate: GifIndexStatus, current: GifIndexStatus): boolean {
  return getStatusTimestamp(candidate) > getStatusTimestamp(current);
}

function isRunningStatusStale(status: GifIndexStatus): boolean {
  if (!status.running) return false;

  const updatedAt = Date.parse(status.updatedAt);
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt > statusSnapshotStaleMs;
}

function getStatusTimestamp(status: GifIndexStatus): number {
  const updatedAt = Date.parse(status.updatedAt);
  if (Number.isFinite(updatedAt)) return updatedAt;

  const completedAt = Date.parse(status.completedAt);
  if (Number.isFinite(completedAt)) return completedAt;

  const startedAt = Date.parse(status.startedAt);
  return Number.isFinite(startedAt) ? startedAt : 0;
}

function readPhase(value: unknown): GifIndexStatus["phase"] {
  return value === "discovering" ||
    value === "indexing" ||
    value === "warming" ||
    value === "writing" ||
    value === "ready" ||
    value === "error" ||
    value === "idle"
    ? value
    : "idle";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
