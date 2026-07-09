import { createHash } from "node:crypto";
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { demoCatalogItems } from "@/lib/demo-catalog";
import { getGifCacheFile, writeCacheFile } from "@/lib/gif-cache";
import { createGifPoster } from "@/lib/gif-variant";
import type {
  CatalogQuery,
  GifCatalogResponse,
  GifCatalogSource,
  GifCategorySummary,
  GifIndexSummary,
  GifItem,
} from "@/types";

export type ArchiveItem = GifItem & {
  absolutePath: string;
  relativePath: string;
};

export type ArchiveScanPhase = "discovering" | "indexing" | "warming" | "writing";

export type ArchiveScanProgress = {
  currentPath: string;
  discoveredFiles: number;
  indexedFiles: number;
  pendingDirectories: number;
  phase: ArchiveScanPhase;
  rootLabel: string;
  scannedDirectories: number;
  totalFiles: number;
};

export type ArchiveIndexResult = {
  count: number;
  rootLabel: string;
  scannedAt: string;
  usesFileProxy: boolean;
};

type ArchiveCache = {
  root: string;
  publicRoot: string;
  items: ArchiveItem[];
  scannedAt: number;
  usesFileProxy: boolean;
  rootLabel: string;
};

type ArchiveManifest = {
  items: ArchiveManifestItem[];
  publicRoot: string;
  root: string;
  rootLabel: string;
  scannedAt: number;
  version: number;
};

type ArchiveManifestItem = {
  bytes: number;
  category: string;
  fileName: string;
  id: string;
  relativePath: string;
  title: string;
  updatedAt: string;
};

type ArchiveScanResult = {
  discoveredFiles: number;
  indexedFiles: number;
  items: ArchiveItem[];
  scannedDirectories: number;
};

type DiscoveredGifFile = {
  absolutePath: string;
  fileName: string;
  relativePath: string;
};

type ArchiveScanCheckpointPhase = "discovering" | "indexing";

type ArchiveScanCheckpoint = {
  discoveredFiles: DiscoveredGifFile[];
  indexedFiles: number;
  items: ArchiveManifestItem[];
  phase: ArchiveScanCheckpointPhase;
  publicRoot: string;
  remainingDirectories: string[];
  root: string;
  rootLabel: string;
  scannedDirectories: number;
  version: number;
};

type LoadArchiveOptions = {
  force?: boolean;
  onProgress?: (progress: ArchiveScanProgress) => void;
  shouldPause?: () => boolean;
  warmPosters?: boolean;
};

const gifExtension = ".gif";
const manifestVersion = 2;
const checkpointVersion = 1;
const defaultLimit = 72;
const maxLimit = 240;
const cacheMs = Number.parseInt(process.env.GIF_CATALOG_CACHE_MS ?? "30000", 10);
const indexTtlMs = readPositiveIntegerEnv("GIF_CATALOG_INDEX_TTL_MS", 600000, 5000);
const indexBatchSize = readPositiveIntegerEnv("GIF_CATALOG_INDEX_BATCH_SIZE", 48, 1);
const posterWarmBatchSize = readPositiveIntegerEnv("GIF_POSTER_WARM_BATCH_SIZE", 1, 1);
let archiveCache: ArchiveCache | null = null;

export async function getGifCatalog(query: CatalogQuery = {}): Promise<GifCatalogResponse> {
  const archive = await loadArchive({
    force: query.refresh === true,
    warmPosters: query.refresh === true,
  });
  const usingDemoCatalog = shouldUseDemoCatalog(archive);
  const sourceItems: GifItem[] = usingDemoCatalog ? demoCatalogItems : archive.items.map(stripInternalFields);
  const source = createSource(archive, usingDemoCatalog);
  const normalizedQuery = query.query?.trim().toLowerCase() ?? "";
  const normalizedCategory = query.category?.trim() ?? "";
  const limit = clampNumber(query.limit ?? defaultLimit, 1, maxLimit);
  const offset = Math.max(0, query.offset ?? 0);

  const queryFiltered = sourceItems.filter((item) => {
    const queryMatch =
      normalizedQuery.length === 0 ||
      [item.title, item.fileName, item.category]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return queryMatch;
  });
  const categories = createCategorySummaries(queryFiltered);
  const filtered = normalizedCategory
    ? queryFiltered.filter((item) => item.category === normalizedCategory)
    : queryFiltered;

  return {
    categories,
    category: normalizedCategory,
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
    query: normalizedQuery,
    source,
  };
}

export async function findGifFileById(id: string): Promise<ArchiveItem | null> {
  const archive = await loadArchive();
  return archive.items.find((item) => item.id === id) ?? null;
}

export async function refreshGifArchive(
  onProgress?: (progress: ArchiveScanProgress) => void,
  shouldPause?: () => boolean,
): Promise<ArchiveIndexResult> {
  const archive = await loadArchive({ force: true, onProgress, shouldPause, warmPosters: true });

  return {
    count: archive.items.length,
    rootLabel: archive.rootLabel,
    scannedAt: new Date(archive.scannedAt).toISOString(),
    usesFileProxy: archive.usesFileProxy,
  };
}

export async function getArchiveIndexSummary(): Promise<GifIndexSummary> {
  const { root, publicRoot, rootLabel } = getArchiveRoots();
  const usesFileProxy = !isInside(root, publicRoot);
  const now = Date.now();
  const cached = archiveCache?.root === root ? archiveCache : null;
  const archive = cached ?? await readArchiveManifest(root, publicRoot, rootLabel, usesFileProxy, now, {
    ignoreTtl: true,
  });

  if (!archive) {
    return {
      cacheTtlMs: indexTtlMs,
      count: 0,
      exists: false,
      rootLabel,
      scannedAt: "",
      stale: true,
      usesFileProxy,
    };
  }

  return {
    cacheTtlMs: indexTtlMs,
    count: archive.items.length,
    exists: true,
    rootLabel: archive.rootLabel,
    scannedAt: new Date(archive.scannedAt).toISOString(),
    stale: now - archive.scannedAt > indexTtlMs,
    usesFileProxy: archive.usesFileProxy,
  };
}

async function loadArchive(options: LoadArchiveOptions = {}): Promise<ArchiveCache> {
  const { root, publicRoot, rootLabel } = getArchiveRoots();
  const cached = archiveCache;
  const now = Date.now();

  if (!options.force && cached && cached.root === root && now - cached.scannedAt < cacheMs) {
    return cached;
  }

  const usesFileProxy = !isInside(root, publicRoot);
  const manifest = options.force
    ? null
    : await readArchiveManifest(root, publicRoot, rootLabel, usesFileProxy, now, {
      ignoreTtl: true,
    });

  if (manifest) {
    archiveCache = manifest;
    return manifest;
  }

  const scan = await scanArchive(
    root,
    publicRoot,
    rootLabel,
    usesFileProxy,
    options.onProgress,
    options.shouldPause,
  );
  if (options.warmPosters) {
    await warmPosterCache(scan.items, rootLabel, scan.discoveredFiles, scan.scannedDirectories, options.onProgress);
  }
  options.onProgress?.({
    currentPath: "catalog manifest",
    discoveredFiles: scan.discoveredFiles,
    indexedFiles: scan.indexedFiles,
    pendingDirectories: 0,
    phase: "writing",
    rootLabel,
    scannedDirectories: scan.scannedDirectories,
    totalFiles: scan.discoveredFiles,
  });
  const nextCache: ArchiveCache = {
    root,
    publicRoot,
    items: scan.items,
    scannedAt: now,
    usesFileProxy,
    rootLabel,
  };

  archiveCache = nextCache;
  await writeArchiveManifest(nextCache);
  await removeArchiveCheckpoint(root);
  return nextCache;
}

async function warmPosterCache(
  items: ArchiveItem[],
  rootLabel: string,
  discoveredFiles: number,
  scannedDirectories: number,
  onProgress?: (progress: ArchiveScanProgress) => void,
): Promise<void> {
  if (items.length === 0 || process.env.GIF_POSTER_PREWARM !== "1") return;

  let completed = 0;

  for (let index = 0; index < items.length; index += posterWarmBatchSize) {
    const batch = items.slice(index, index + posterWarmBatchSize);

    await Promise.all(batch.map(async (item) => {
      try {
        await createGifPoster(item);
      } catch {
        // A broken GIF should not block the whole archive index.
      }
    }));

    completed += batch.length;
    onProgress?.({
      currentPath: batch.at(-1)?.relativePath ?? "poster cache",
      discoveredFiles,
      indexedFiles: completed,
      pendingDirectories: 0,
      phase: "warming",
      rootLabel,
      scannedDirectories,
      totalFiles: items.length,
    });
  }
}

async function scanArchive(
  root: string,
  publicRoot: string,
  rootLabel: string,
  usesFileProxy: boolean,
  onProgress?: (progress: ArchiveScanProgress) => void,
  shouldPause?: () => boolean,
): Promise<ArchiveScanResult> {
  const rootStats = await safeStat(root);

  if (!rootStats?.isDirectory()) {
    onProgress?.({
      currentPath: rootLabel,
      discoveredFiles: 0,
      indexedFiles: 0,
      pendingDirectories: 0,
      phase: "discovering",
      rootLabel,
      scannedDirectories: 0,
      totalFiles: 0,
    });

    return {
      discoveredFiles: 0,
      indexedFiles: 0,
      items: [],
      scannedDirectories: 0,
    };
  }

  const checkpoint = await readArchiveCheckpoint(root, publicRoot, rootLabel);
  const discoveredFiles: DiscoveredGifFile[] = checkpoint?.discoveredFiles ?? [];
  const items: ArchiveItem[] = checkpoint?.items.map((item) =>
    hydrateManifestItem(item, root, publicRoot, usesFileProxy)
  ) ?? [];
  const stack = checkpoint?.phase === "discovering" ? [...checkpoint.remainingDirectories] : [root];
  let scannedDirectories = checkpoint?.scannedDirectories ?? 0;

  while (checkpoint?.phase !== "indexing" && stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    scannedDirectories += 1;
    const entries = await safeReadDir(current);
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== gifExtension) {
        continue;
      }

      const relativePath = path.relative(root, absolutePath);
      discoveredFiles.push({
        absolutePath,
        fileName: entry.name,
        relativePath,
      });
    }

    onProgress?.({
      currentPath: path.relative(root, current) || rootLabel,
      discoveredFiles: discoveredFiles.length,
      indexedFiles: 0,
      pendingDirectories: stack.length,
      phase: "discovering",
      rootLabel,
      scannedDirectories,
      totalFiles: 0,
    });

    await writeArchiveCheckpoint({
      discoveredFiles,
      indexedFiles: 0,
      items: [],
      phase: "discovering",
      publicRoot,
      remainingDirectories: stack,
      root,
      rootLabel,
      scannedDirectories,
      version: checkpointVersion,
    });
    throwIfPaused(shouldPause);
  }

  await writeArchiveCheckpoint({
    discoveredFiles,
    indexedFiles: checkpoint?.indexedFiles ?? items.length,
    items: items.map(toManifestItem),
    phase: "indexing",
    publicRoot,
    remainingDirectories: [],
    root,
    rootLabel,
    scannedDirectories,
    version: checkpointVersion,
  });

  let indexedFiles = checkpoint?.indexedFiles ?? items.length;

  for (let index = 0; index < discoveredFiles.length; index += indexBatchSize) {
    if (index < indexedFiles) continue;

    const batch = discoveredFiles.slice(index, index + indexBatchSize);
    const fileItems = await Promise.all(batch.map((file) =>
      createArchiveItem(file, publicRoot, usesFileProxy),
    ));

    indexedFiles += batch.length;
    items.push(...fileItems.filter((item): item is ArchiveItem => item !== null));

    onProgress?.({
      currentPath: batch.at(-1)?.relativePath ?? rootLabel,
      discoveredFiles: discoveredFiles.length,
      indexedFiles,
      pendingDirectories: 0,
      phase: "indexing",
      rootLabel,
      scannedDirectories,
      totalFiles: discoveredFiles.length,
    });

    await writeArchiveCheckpoint({
      discoveredFiles,
      indexedFiles,
      items: items.map(toManifestItem),
      phase: "indexing",
      publicRoot,
      remainingDirectories: [],
      root,
      rootLabel,
      scannedDirectories,
      version: checkpointVersion,
    });
    throwIfPaused(shouldPause);
  }

  return {
    discoveredFiles: discoveredFiles.length,
    indexedFiles,
    items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    scannedDirectories,
  };
}

async function createArchiveItem(
  file: DiscoveredGifFile,
  publicRoot: string,
  usesFileProxy: boolean,
): Promise<ArchiveItem | null> {
  const fileStats = await safeStat(file.absolutePath);
  if (!fileStats?.isFile()) return null;

  const id = createId(file.relativePath);
  const category = toFileNameCategory(file.fileName);
  const src = usesFileProxy ? `/api/gifs/file/${id}` : toPublicSrc(publicRoot, file.absolutePath);

  return {
    id,
    title: toTitle(path.basename(file.fileName, gifExtension)),
    fileName: file.fileName,
    src,
    category,
    bytes: fileStats.size,
    updatedAt: fileStats.mtime.toISOString(),
    origin: "archive",
    absolutePath: file.absolutePath,
    relativePath: file.relativePath,
  };
}

async function readArchiveManifest(
  root: string,
  publicRoot: string,
  rootLabel: string,
  usesFileProxy: boolean,
  now: number,
  options: { ignoreTtl?: boolean } = {},
): Promise<ArchiveCache | null> {
  try {
    const manifestPath = getArchiveManifestPath(root);
    const manifest = parseArchiveManifest(await readFile(manifestPath, "utf8"));

    if (!manifest) return null;
    if (manifest.root !== root || manifest.publicRoot !== publicRoot) return null;
    if (manifest.rootLabel !== rootLabel) return null;
    if (!options.ignoreTtl && now - manifest.scannedAt > indexTtlMs) return null;

    return {
      root,
      publicRoot,
      items: manifest.items.map((item) => hydrateManifestItem(item, root, publicRoot, usesFileProxy)),
      scannedAt: manifest.scannedAt,
      usesFileProxy,
      rootLabel,
    };
  } catch {
    return null;
  }
}

async function writeArchiveManifest(archive: ArchiveCache): Promise<void> {
  const manifest: ArchiveManifest = {
    items: archive.items.map(toManifestItem),
    publicRoot: archive.publicRoot,
    root: archive.root,
    rootLabel: archive.rootLabel,
    scannedAt: archive.scannedAt,
    version: manifestVersion,
  };

  try {
    await writeCacheFile(getArchiveManifestPath(archive.root), JSON.stringify(manifest));
  } catch {
    // The app can still run with in-memory results when the cache volume is not writable.
  }
}

async function readArchiveCheckpoint(
  root: string,
  publicRoot: string,
  rootLabel: string,
): Promise<ArchiveScanCheckpoint | null> {
  try {
    const checkpoint = parseArchiveCheckpoint(await readFile(getArchiveCheckpointPath(root), "utf8"));

    if (!checkpoint) return null;
    if (checkpoint.root !== root || checkpoint.publicRoot !== publicRoot || checkpoint.rootLabel !== rootLabel) {
      return null;
    }

    return checkpoint;
  } catch {
    return null;
  }
}

async function writeArchiveCheckpoint(checkpoint: ArchiveScanCheckpoint): Promise<void> {
  try {
    await writeCacheFile(getArchiveCheckpointPath(checkpoint.root), JSON.stringify(checkpoint));
  } catch {
    // Resume is best-effort; indexing can still complete without a writable checkpoint.
  }
}

async function removeArchiveCheckpoint(root: string): Promise<void> {
  try {
    await unlink(getArchiveCheckpointPath(root));
  } catch {
    // Missing checkpoint is fine after a clean index write.
  }
}

function getArchiveCheckpointPath(root: string): string {
  return getGifCacheFile("catalog", `checkpoint:${root}`, "json");
}

function parseArchiveCheckpoint(raw: string): ArchiveScanCheckpoint | null {
  const value = JSON.parse(raw) as unknown;
  const record = toRecord(value);

  if (!record) return null;
  if (record.version !== checkpointVersion) return null;

  const root = record.root;
  const publicRoot = record.publicRoot;
  const rootLabel = record.rootLabel;
  const phase = record.phase;
  const discoveredFiles = record.discoveredFiles;
  const indexedFiles = record.indexedFiles;
  const items = record.items;
  const remainingDirectories = record.remainingDirectories;
  const scannedDirectories = record.scannedDirectories;

  if (
    typeof root !== "string" ||
    typeof publicRoot !== "string" ||
    typeof rootLabel !== "string" ||
    (phase !== "discovering" && phase !== "indexing") ||
    typeof indexedFiles !== "number" ||
    !Number.isFinite(indexedFiles) ||
    typeof scannedDirectories !== "number" ||
    !Number.isFinite(scannedDirectories) ||
    !Array.isArray(discoveredFiles) ||
    !Array.isArray(items) ||
    !Array.isArray(remainingDirectories)
  ) {
    return null;
  }

  return {
    discoveredFiles: discoveredFiles.flatMap((item) => {
      const parsed = parseDiscoveredGifFile(item);
      return parsed ? [parsed] : [];
    }),
    indexedFiles: Math.max(0, indexedFiles),
    items: items.flatMap((item) => {
      const parsed = parseArchiveManifestItem(item);
      return parsed ? [parsed] : [];
    }),
    phase,
    publicRoot,
    remainingDirectories: remainingDirectories.filter((item): item is string => typeof item === "string"),
    root,
    rootLabel,
    scannedDirectories: Math.max(0, scannedDirectories),
    version: checkpointVersion,
  };
}

export async function getArchiveIndexCheckpointSummary(): Promise<{
  discoveredFiles: number;
  exists: boolean;
  indexedFiles: number;
  rootLabel: string;
  scannedDirectories: number;
}> {
  const { root, publicRoot, rootLabel } = getArchiveRoots();
  const checkpoint = await readArchiveCheckpoint(root, publicRoot, rootLabel);

  if (!checkpoint) {
    return {
      discoveredFiles: 0,
      exists: false,
      indexedFiles: 0,
      rootLabel,
      scannedDirectories: 0,
    };
  }

  return {
    discoveredFiles: checkpoint.discoveredFiles.length,
    exists: true,
    indexedFiles: checkpoint.indexedFiles,
    rootLabel,
    scannedDirectories: checkpoint.scannedDirectories,
  };
}

function parseDiscoveredGifFile(value: unknown): DiscoveredGifFile | null {
  const record = toRecord(value);
  if (!record) return null;

  const absolutePath = record.absolutePath;
  const fileName = record.fileName;
  const relativePath = record.relativePath;

  if (typeof absolutePath !== "string" || typeof fileName !== "string" || typeof relativePath !== "string") {
    return null;
  }

  return {
    absolutePath,
    fileName,
    relativePath,
  };
}

function toManifestItem(item: ArchiveItem): ArchiveManifestItem {
  return {
    bytes: item.bytes,
    category: item.category,
    fileName: item.fileName,
    id: item.id,
    relativePath: item.relativePath,
    title: item.title,
    updatedAt: item.updatedAt,
  };
}

function throwIfPaused(shouldPause?: () => boolean): void {
  if (!shouldPause?.()) return;

  const error = new Error("Index paused");
  error.name = "ArchiveIndexPausedError";
  throw error;
}

function hydrateManifestItem(
  item: ArchiveManifestItem,
  root: string,
  publicRoot: string,
  usesFileProxy: boolean,
): ArchiveItem {
  const absolutePath = path.join(root, item.relativePath);

  return {
    id: item.id,
    title: item.title,
    fileName: item.fileName,
    src: usesFileProxy ? `/api/gifs/file/${item.id}` : toPublicSrc(publicRoot, absolutePath),
    category: item.category,
    bytes: item.bytes,
    updatedAt: item.updatedAt,
    origin: "archive",
    absolutePath,
    relativePath: item.relativePath,
  };
}

function getArchiveManifestPath(root: string): string {
  return getGifCacheFile("catalog", `manifest:${root}`, "json");
}

function parseArchiveManifest(raw: string): ArchiveManifest | null {
  const value = JSON.parse(raw) as unknown;
  const record = toRecord(value);

  if (!record) return null;

  const version = record.version;
  const root = record.root;
  const publicRoot = record.publicRoot;
  const rootLabel = record.rootLabel;
  const scannedAt = record.scannedAt;
  const items = record.items;

  if (version !== manifestVersion) return null;
  if (typeof root !== "string" || typeof publicRoot !== "string" || typeof rootLabel !== "string") {
    return null;
  }
  if (typeof scannedAt !== "number" || !Number.isFinite(scannedAt)) return null;
  if (!Array.isArray(items)) return null;

  return {
    items: items.flatMap((item) => {
      const parsed = parseArchiveManifestItem(item);
      return parsed ? [parsed] : [];
    }),
    publicRoot,
    root,
    rootLabel,
    scannedAt,
    version,
  };
}

function parseArchiveManifestItem(value: unknown): ArchiveManifestItem | null {
  const record = toRecord(value);
  if (!record) return null;

  const bytes = record.bytes;
  const category = record.category;
  const fileName = record.fileName;
  const id = record.id;
  const relativePath = record.relativePath;
  const title = record.title;
  const updatedAt = record.updatedAt;

  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return null;
  if (
    typeof category !== "string" ||
    typeof fileName !== "string" ||
    typeof id !== "string" ||
    typeof relativePath !== "string" ||
    typeof title !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }

  return {
    bytes,
    category,
    fileName,
    id,
    relativePath,
    title,
    updatedAt,
  };
}

function getArchiveRoots(): { root: string; publicRoot: string; rootLabel: string } {
  const publicRoot = path.join(process.cwd(), "public");
  const configured = process.env.GIF_ARCHIVE_DIR?.trim();
  const root = configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(publicRoot, "gif-archive");

  return {
    root,
    publicRoot,
    rootLabel: configured ? "GIF_ARCHIVE_DIR" : "public/gif-archive",
  };
}

function createSource(archive: ArchiveCache, usingDemoCatalog: boolean): GifCatalogSource {
  return {
    mode: usingDemoCatalog ? "demo" : "archive",
    rootLabel: archive.rootLabel,
    usesFileProxy: archive.usesFileProxy,
    scannedAt: new Date(archive.scannedAt).toISOString(),
  };
}

function shouldUseDemoCatalog(archive: ArchiveCache): boolean {
  return archive.items.length === 0 &&
    process.env.NODE_ENV !== "production" &&
    !process.env.GIF_ARCHIVE_DIR?.trim();
}

function stripInternalFields(item: ArchiveItem): GifItem {
  return {
    id: item.id,
    title: item.title,
    fileName: item.fileName,
    src: item.src,
    category: item.category,
    bytes: item.bytes,
    updatedAt: item.updatedAt,
    origin: item.origin,
  };
}

function createId(relativePath: string): string {
  return createHash("sha1").update(relativePath.replaceAll("\\", "/")).digest("hex").slice(0, 16);
}

function toPublicSrc(publicRoot: string, absolutePath: string): string {
  return `/${path.relative(publicRoot, absolutePath).replaceAll("\\", "/")}`;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function createCategorySummaries(items: GifItem[]): GifCategorySummary[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }

  return Array.from(counts, ([name, count]) => ({ count, name }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function toFileNameCategory(fileName: string): string {
  const baseName = path.basename(fileName, gifExtension);
  const firstMeaningfulSegment = baseName
    .split(/[_.\-\s()[\]]+/)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0 && !/^\d+$/.test(segment));

  return firstMeaningfulSegment ? toTitle(firstMeaningfulSegment) : "General";
}

function toTitle(value: string): string {
  return value
    .split(/[_.\-\s]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

async function safeReadDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readPositiveIntegerEnv(name: string, fallback: number, min: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}
