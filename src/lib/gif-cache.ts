import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createCacheHash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function getGifCacheRoot(): string {
  const configured = process.env.GIF_CACHE_DIR?.trim();
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(/* turbopackIgnore: true */ process.cwd(), "data", "cache");
}

export function getGifCacheFile(section: string, key: string, extension: string): string {
  const safeExtension = extension.replace(/^\./, "");
  return path.join(
    /* turbopackIgnore: true */ getGifCacheRoot(),
    section,
    `${createCacheHash(key)}.${safeExtension}`,
  );
}

export async function writeCacheFile(filePath: string, data: Buffer | string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, filePath);
}
