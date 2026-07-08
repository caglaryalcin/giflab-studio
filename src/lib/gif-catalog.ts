import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { demoCatalogItems } from "@/lib/demo-catalog";
import { getGifCacheFile, writeCacheFile } from "@/lib/gif-cache";
import type { CatalogQuery, GifCatalogResponse, GifCatalogSource, GifIndexSummary, GifItem } from "@/types";

export type ArchiveItem = GifItem & {
  absolutePath: string;
  relativePath: string;
};

export type ArchiveScanPhase = "discovering" | "indexing" | "writing";

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

type LoadArchiveOptions = {
  force?: boolean;
  onProgress?: (progress: ArchiveScanProgress) => void;
};

const gifExtension = ".gif";
const manifestVersion = 1;
const defaultLimit = 72;
const maxLimit = 240;
const cacheMs = Number.parseInt(process.env.GIF_CATALOG_CACHE_MS ?? "30000", 10);
const indexTtlMs = readPositiveIntegerEnv("GIF_CATALOG_INDEX_TTL_MS", 600000, 5000);
const indexBatchSize = readPositiveIntegerEnv("GIF_CATALOG_INDEX_BATCH_SIZE", 48, 1);
let archiveCache: ArchiveCache | null = null;

export async function getGifCatalog(query: CatalogQuery = {}): Promise<GifCatalogResponse> {
  const archive = await loadArchive({ force: query.refresh === true });
  const hasArchiveItems = archive.items.length > 0;
  const sourceItems: GifItem[] = hasArchiveItems ? archive.items.map(stripInternalFields) : demoCatalogItems;
  const source = createSource(archive, hasArchiveItems);
  const normalizedQuery = query.query?.trim().toLowerCase() ?? "";
  const limit = clampNumber(query.limit ?? defaultLimit, 1, maxLimit);
  const offset = Math.max(0, query.offset ?? 0);

  const filtered = sourceItems.filter((item) => {
    const queryMatch =
      normalizedQuery.length === 0 ||
      [item.title, item.fileName, item.category]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return queryMatch;
  });

  return {
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
): Promise<ArchiveIndexResult> {
  const archive = await loadArchive({ force: true, onProgress });

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
    : await readArchiveManifest(root, publicRoot, rootLabel, usesFileProxy, now);

  if (manifest) {
    archiveCache = manifest;
    return manifest;
  }

  const scan = await scanArchive(root, publicRoot, rootLabel, usesFileProxy, options.onProgress);
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
  return nextCache;
}

async function scanArchive(
  root: string,
  publicRoot: string,
  rootLabel: string,
  usesFileProxy: boolean,
  onProgress?: (progress: ArchiveScanProgress) => void,
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

  const discoveredFiles: DiscoveredGifFile[] = [];
  const items: ArchiveItem[] = [];
  const stack = [root];
  let scannedDirectories = 0;

  while (stack.length > 0) {
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
  }

  let indexedFiles = 0;

  for (let index = 0; index < discoveredFiles.length; index += indexBatchSize) {
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
  const category = toCategory(file.relativePath);
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
    items: archive.items.map((item) => ({
      bytes: item.bytes,
      category: item.category,
      fileName: item.fileName,
      id: item.id,
      relativePath: item.relativePath,
      title: item.title,
      updatedAt: item.updatedAt,
    })),
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

function createSource(archive: ArchiveCache, hasArchiveItems: boolean): GifCatalogSource {
  return {
    mode: hasArchiveItems ? "archive" : "demo",
    rootLabel: archive.rootLabel,
    usesFileProxy: archive.usesFileProxy,
    scannedAt: new Date(archive.scannedAt).toISOString(),
  };
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

function toCategory(relativePath: string): string {
  const segments = relativePath.split(path.sep).filter(Boolean);
  return segments.length > 1 ? toTitle(segments[0]) : "General";
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
