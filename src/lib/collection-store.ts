import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GifCollection, GifCollectionStore, GifItem, GifSourceMode } from "@/types";

const defaultStore: GifCollectionStore = {
  activeCollectionId: "",
  collections: [],
  itemsById: {},
  updatedAt: "",
};

export async function readCollectionStore(): Promise<GifCollectionStore> {
  try {
    const raw = await readFile(getCollectionStorePath(), "utf8");
    return normalizeCollectionStore(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return defaultStore;
    }

    throw error;
  }
}

export async function writeCollectionStore(input: unknown): Promise<GifCollectionStore> {
  const store = {
    ...normalizeCollectionStore(input),
    updatedAt: new Date().toISOString(),
  };
  const storePath = getCollectionStorePath();
  const tempPath = `${storePath}.${process.pid}.tmp`;

  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  await rename(tempPath, storePath);

  return store;
}

export function normalizeCollectionStore(input: unknown): GifCollectionStore {
  if (!isRecord(input)) return defaultStore;

  const collections = readCollections(input.collections);
  const activeCollectionId = readString(input.activeCollectionId);
  const safeActiveCollectionId = collections.some((collection) => collection.id === activeCollectionId)
    ? activeCollectionId
    : collections[0]?.id ?? "";

  return {
    activeCollectionId: safeActiveCollectionId,
    collections,
    itemsById: readItemsById(input.itemsById),
    updatedAt: readString(input.updatedAt),
  };
}

function getCollectionStorePath(): string {
  const configuredPath = process.env.GIF_COLLECTIONS_FILE?.trim();
  return configuredPath
    ? path.resolve(/* turbopackIgnore: true */ configuredPath)
    : path.join(/* turbopackIgnore: true */ process.cwd(), "data", "collections.json");
}

function readCollections(value: unknown): GifCollection[] {
  if (!Array.isArray(value)) return [];

  const collections: GifCollection[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    const id = readString(entry.id);
    const name = readString(entry.name);

    if (!id || !name || seenIds.has(id)) continue;

    seenIds.add(id);
    collections.push({
      id,
      itemIds: readUniqueStrings(entry.itemIds),
      name,
    });
  }

  return collections;
}

function readItemsById(value: unknown): Record<string, GifItem> {
  if (!isRecord(value)) return {};

  const itemsById: Record<string, GifItem> = {};

  for (const [id, itemValue] of Object.entries(value)) {
    const item = readGifItem(itemValue);
    if (!item || item.id !== id) continue;
    itemsById[id] = item;
  }

  return itemsById;
}

function readGifItem(value: unknown): GifItem | null {
  if (!isRecord(value)) return null;

  const origin = readSourceMode(value.origin);
  const bytes = readNumber(value.bytes);

  if (!origin || bytes < 0) return null;

  const item: GifItem = {
    bytes,
    category: readString(value.category),
    fileName: readString(value.fileName),
    id: readString(value.id),
    origin,
    src: readString(value.src),
    title: readString(value.title),
    updatedAt: readString(value.updatedAt),
  };

  return item.id && item.title && item.src ? item : null;
}

function readSourceMode(value: unknown): GifSourceMode | null {
  return value === "archive" || value === "demo" ? value : null;
}

function readUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)),
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
