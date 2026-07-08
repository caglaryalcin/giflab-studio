import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { ArchiveItem } from "@/lib/gif-catalog";
import { getGifCacheFile, writeCacheFile } from "@/lib/gif-cache";
import { findVariant, variantRecipes } from "@/lib/color-variants";
import type {
  GifColorAnalysis,
  GifColorReplacement,
  GifColorSlot,
  GifEditorRequest,
  GifExportSettings,
  GifPreviewFrameData,
  StrokeWeight,
} from "@/types";

export type ExportVariantMode = "original" | "tint" | "hue";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type Hsl = {
  h: number;
  s: number;
  l: number;
};

type DecodedGif = {
  data: Buffer;
  delay?: number[];
  height: number;
  loop?: number;
  pageHeight: number;
  pages: number;
  width: number;
};

type ColorBucket = Rgb & {
  count: number;
};

type InternalColorSlot = GifColorSlot & {
  rgb: Rgb;
};

const backgroundLuminance = 248;
const colorDistanceLimit = 118;
const replacementSourceDistanceLimit = 64;
const analysisTargetPixels = readPositiveIntegerEnv("GIF_ANALYSIS_TARGET_PIXELS", 1400000, 250000);
const analysisCacheLimit = readPositiveIntegerEnv("GIF_ANALYSIS_CACHE_ITEMS", 48, 4);
const previewCacheLimit = readPositiveIntegerEnv("GIF_PREVIEW_CACHE_ITEMS", 12, 2);
const previewFrameLimit = readPositiveIntegerEnv("GIF_PREVIEW_MAX_FRAMES", 48, 12);
const decodedCacheLimit = readPositiveIntegerEnv("GIF_DECODE_CACHE_ITEMS", 2, 1);
const decodedCacheMs = readPositiveIntegerEnv("GIF_DECODE_CACHE_MS", 3000, 500);

const analysisCache = new Map<string, Promise<GifColorAnalysis>>();
const previewCache = new Map<string, Promise<GifPreviewFrameData>>();
const decodedCache = new Map<
  string,
  {
    promise: Promise<DecodedGif>;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

export function analyzeGif(item: ArchiveItem): Promise<GifColorAnalysis> {
  return rememberPromise(
    analysisCache,
    createItemCacheKey(item),
    analysisCacheLimit,
    async () => {
      const cached = await readJsonCache(getAnalysisCachePath(item), isGifColorAnalysis);
      if (cached) return cached;

      const analysis = await analyzeGifUncached(item);
      await writeJsonCache(getAnalysisCachePath(item), analysis);
      return analysis;
    },
  );
}

async function analyzeGifUncached(item: ArchiveItem): Promise<GifColorAnalysis> {
  const decoded = await readDecodedGif(item);
  const slots = extractColorSlots(decoded.data, getAnalysisPixelStride(decoded));

  return createColorAnalysis(item, slots);
}

function createColorAnalysis(
  item: ArchiveItem,
  slots: InternalColorSlot[],
): GifColorAnalysis {
  return {
    itemId: item.id,
    colors: slots.map((slot) => ({
      id: slot.id,
      hex: slot.hex,
      count: slot.count,
      percentage: slot.percentage,
      luminance: slot.luminance,
      isStroke: slot.isStroke,
    })),
    stroke: "regular",
  };
}

export async function createEditedGif(
  item: ArchiveItem,
  request: GifEditorRequest,
): Promise<Buffer> {
  const decoded = await decodeGifUncached(item);
  const slots = extractColorSlots(decoded.data);
  const replacements = createReplacementMap(Array.isArray(request.colors) ? request.colors : []);
  const stroke = normalizeStroke(request.stroke);
  const strokeSlot = slots.find((slot) => slot.isStroke) ?? slots[0];
  const strokeMask = strokeSlot ? createStrokeMask(decoded.data, slots, strokeSlot) : null;
  const exportSettings = normalizeExportSettings(request.export);

  applyColorReplacements(decoded.data, slots, replacements);

  if (strokeMask && strokeSlot) {
    applyStrokeWeight(decoded.data, strokeMask, decoded, stroke);
  }

  if (exportSettings) {
    applyExportBackground(decoded.data, exportSettings);
    const resized = await resizeDecodedGif(decoded, exportSettings);
    applyExportTiming(resized, exportSettings);
    return encodeGif(resized);
  }

  return encodeGif(decoded);
}

export async function createGifPreview(
  item: ArchiveItem,
  maxSize = 180,
): Promise<GifPreviewFrameData> {
  return rememberPromise(
    previewCache,
    `${createItemCacheKey(item)}:${maxSize}`,
    previewCacheLimit,
    async () => {
      const cachePath = getPreviewCachePath(item, maxSize);
      const cached = await readJsonCache(cachePath, isGifPreviewFrameData);
      if (cached) return cached;

      const decoded = await readDecodedGif(item);
      const preview = await createPreviewFromDecoded(item, decoded, maxSize);
      await writeJsonCache(cachePath, preview);
      return preview;
    },
  );
}

async function createPreviewFromDecoded(
  item: ArchiveItem,
  decoded: DecodedGif,
  maxSize: number,
): Promise<GifPreviewFrameData> {
  const { data, info } = await sharp(decoded.data, {
    animated: decoded.pages > 1,
    limitInputPixels: false,
    raw: {
      channels: 4,
      height: decoded.height,
      pageHeight: decoded.pageHeight,
      width: decoded.width,
    },
  })
    .resize({
      fit: "inside",
      height: maxSize,
      width: maxSize,
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frameInfo = info as typeof info & {
    pageHeight?: number;
    pages?: number;
  };
  const pages = frameInfo.pages ?? decoded.pages;
  const pageHeight = frameInfo.pageHeight ?? Math.max(1, Math.round(info.height / pages));
  const compacted = compactPreviewFrames(
    data,
    info.width,
    pageHeight,
    pages,
    normalizeDelay(decoded.delay, pages),
  );

  return {
    data: compacted.data.toString("base64"),
    delay: compacted.delay,
    itemId: item.id,
    pageHeight,
    pages: compacted.pages,
    width: info.width,
  };
}

export async function createGifPoster(item: ArchiveItem, maxSize = 146): Promise<Buffer> {
  const cachePath = getPosterCachePath(item, maxSize);
  const cached = await readBufferCache(cachePath);
  if (cached) return cached;

  const poster = await sharp(item.absolutePath, {
    limitInputPixels: false,
  })
    .resize({
      fit: "inside",
      height: maxSize,
      width: maxSize,
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .png({
      compressionLevel: 8,
      effort: 8,
    })
    .toBuffer();

  await writeBufferCache(cachePath, poster);
  return poster;
}

export async function createGifVariant(
  item: ArchiveItem,
  mode: ExportVariantMode,
  variantId: string,
): Promise<Buffer> {
  if (mode === "original") {
    return sharp(item.absolutePath, { animated: true }).gif({ reuse: true }).toBuffer();
  }

  const variant = findVariant(variantId);
  const analysis = await analyzeGif(item);
  const colors = analysis.colors.map((slot) => ({
    source: slot.hex,
    target: variant.hex,
  }));

  return createEditedGif(item, {
    colors,
    stroke: "regular",
  });
}

export function createEditorFileName(originalFileName: string, stroke: StrokeWeight): string {
  const base = originalFileName.replace(/\.gif$/i, "");
  return `${base}-edited-${stroke}.gif`;
}

function readDecodedGif(item: ArchiveItem): Promise<DecodedGif> {
  const key = createItemCacheKey(item);
  const cached = decodedCache.get(key);

  if (cached) {
    decodedCache.delete(key);
    decodedCache.set(key, cached);
    return cached.promise;
  }

  const promise = decodeGifUncached(item).catch((error: unknown) => {
    const entry = decodedCache.get(key);
    if (entry?.promise === promise) {
      clearTimeout(entry.timeout);
      decodedCache.delete(key);
    }

    throw error;
  });
  const timeout = setTimeout(() => {
    const entry = decodedCache.get(key);
    if (entry?.promise === promise) {
      decodedCache.delete(key);
    }
  }, decodedCacheMs);

  decodedCache.set(key, { promise, timeout });
  trimDecodedCache();

  return promise;
}

function decodeGifUncached(item: ArchiveItem): Promise<DecodedGif> {
  const input = sharp(item.absolutePath, {
    animated: true,
    limitInputPixels: false,
  }).ensureAlpha();

  return input.metadata().then(async (metadata) => {
    const { data, info } = await input.raw().toBuffer({ resolveWithObject: true });
    const pages = metadata.pages ?? 1;
    const pageHeight = metadata.pageHeight ?? Math.max(1, Math.round(info.height / pages));

    return {
      data,
      delay: metadata.delay,
      height: info.height,
      loop: metadata.loop,
      pageHeight,
      pages,
      width: info.width,
    };
  });
}

function encodeGif(decoded: DecodedGif): Promise<Buffer> {
  return sharp(decoded.data, {
    animated: decoded.pages > 1,
    limitInputPixels: false,
    raw: {
      channels: 4,
      height: decoded.height,
      pageHeight: decoded.pageHeight,
      width: decoded.width,
    },
  })
    .gif({
      colours: 256,
      dither: 0.78,
      effort: 7,
      interFrameMaxError: 0,
      interPaletteMaxError: 3,
      delay: decoded.delay,
      loop: decoded.loop,
      reuse: false,
    })
    .toBuffer();
}

function normalizeDelay(delay: number[] | undefined, pages: number): number[] {
  return Array.from({ length: pages }, (_, index) => {
    const value = delay?.[index] ?? delay?.[0] ?? 80;
    return Math.max(24, value);
  });
}

function createItemCacheKey(item: ArchiveItem): string {
  return `${item.id}:${item.updatedAt}:${item.bytes}:${item.absolutePath}`;
}

function getAnalysisCachePath(item: ArchiveItem): string {
  return getGifCacheFile(
    "analysis",
    `analysis:v2:${analysisTargetPixels}:${createItemCacheKey(item)}`,
    "json",
  );
}

function getPosterCachePath(item: ArchiveItem, maxSize: number): string {
  return getGifCacheFile("posters", `poster:v1:${maxSize}:${createItemCacheKey(item)}`, "png");
}

function getPreviewCachePath(item: ArchiveItem, maxSize: number): string {
  return getGifCacheFile(
    "previews",
    `preview:v2:${maxSize}:${previewFrameLimit}:${createItemCacheKey(item)}`,
    "json",
  );
}

async function readBufferCache(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function writeBufferCache(filePath: string, data: Buffer): Promise<void> {
  try {
    await writeCacheFile(filePath, data);
  } catch {
    // Processing should still succeed when the cache volume is unavailable.
  }
}

async function readJsonCache<T>(
  filePath: string,
  isValue: (value: unknown) => value is T,
): Promise<T | null> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isValue(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeJsonCache<T>(filePath: string, data: T): Promise<void> {
  try {
    await writeCacheFile(filePath, JSON.stringify(data));
  } catch {
    // Processing should still succeed when the cache volume is unavailable.
  }
}

function isGifColorAnalysis(value: unknown): value is GifColorAnalysis {
  const record = toRecord(value);

  return Boolean(
    record &&
      typeof record.itemId === "string" &&
      isStrokeWeight(record.stroke) &&
      Array.isArray(record.colors) &&
      record.colors.every(isGifColorSlot),
  );
}

function isGifColorSlot(value: unknown): value is GifColorSlot {
  const record = toRecord(value);

  return Boolean(
    record &&
      typeof record.id === "string" &&
      typeof record.hex === "string" &&
      isHexColor(record.hex) &&
      typeof record.count === "number" &&
      Number.isFinite(record.count) &&
      typeof record.percentage === "number" &&
      Number.isFinite(record.percentage) &&
      typeof record.luminance === "number" &&
      Number.isFinite(record.luminance) &&
      typeof record.isStroke === "boolean",
  );
}

function isGifPreviewFrameData(value: unknown): value is GifPreviewFrameData {
  const record = toRecord(value);

  return Boolean(
    record &&
      typeof record.data === "string" &&
      Array.isArray(record.delay) &&
      record.delay.every((delay) => typeof delay === "number" && Number.isFinite(delay)) &&
      typeof record.itemId === "string" &&
      typeof record.pageHeight === "number" &&
      Number.isFinite(record.pageHeight) &&
      typeof record.pages === "number" &&
      Number.isFinite(record.pages) &&
      typeof record.width === "number" &&
      Number.isFinite(record.width),
  );
}

function isStrokeWeight(value: unknown): value is StrokeWeight {
  return value === "light" || value === "regular" || value === "bold";
}

function readPositiveIntegerEnv(name: string, fallback: number, min: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function rememberPromise<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  limit: number,
  factory: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key);

  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const promise = factory().catch((error: unknown) => {
    if (cache.get(key) === promise) {
      cache.delete(key);
    }

    throw error;
  });

  cache.set(key, promise);
  trimPromiseCache(cache, limit);

  return promise;
}

function trimPromiseCache<T>(cache: Map<string, Promise<T>>, limit: number): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (!oldest) return;
    cache.delete(oldest);
  }
}

function trimDecodedCache(): void {
  while (decodedCache.size > decodedCacheLimit) {
    const oldest = decodedCache.keys().next().value;
    if (!oldest) return;

    const entry = decodedCache.get(oldest);
    if (entry) clearTimeout(entry.timeout);
    decodedCache.delete(oldest);
  }
}

function getAnalysisPixelStride(decoded: DecodedGif): number {
  const pixels = Math.max(1, Math.floor(decoded.data.length / 4));

  if (pixels <= analysisTargetPixels) {
    return 1;
  }

  const stride = Math.max(1, Math.floor(pixels / analysisTargetPixels));
  return stride % 2 === 0 ? stride + 1 : stride;
}

function compactPreviewFrames(
  data: Buffer,
  width: number,
  pageHeight: number,
  pages: number,
  delay: number[],
): { data: Buffer; delay: number[]; pages: number } {
  if (pages <= previewFrameLimit) {
    return { data, delay, pages };
  }

  const frameStride = Math.ceil(pages / previewFrameLimit);
  const frameLength = width * pageHeight * 4;
  const nextPages = Math.ceil(pages / frameStride);
  const nextData = Buffer.alloc(frameLength * nextPages);
  const nextDelay: number[] = [];

  for (
    let sourceFrame = 0, targetFrame = 0;
    sourceFrame < pages;
    sourceFrame += frameStride, targetFrame += 1
  ) {
    const sourceStart = sourceFrame * frameLength;
    data.copy(nextData, targetFrame * frameLength, sourceStart, sourceStart + frameLength);

    let mergedDelay = 0;
    const frameEnd = Math.min(pages, sourceFrame + frameStride);

    for (let frame = sourceFrame; frame < frameEnd; frame += 1) {
      mergedDelay += delay[frame] ?? delay[0] ?? 80;
    }

    nextDelay.push(Math.max(24, mergedDelay));
  }

  return {
    data: nextData,
    delay: nextDelay,
    pages: nextPages,
  };
}

function normalizeExportSettings(settings: GifExportSettings | undefined): GifExportSettings | null {
  if (!settings) return null;

  const size = Number.isFinite(settings.size) ? Math.round(settings.size) : 400;
  const delay = Number.isFinite(settings.delay) ? Math.round(settings.delay) : 2000;
  const backgroundColor = isHexColor(settings.backgroundColor) ? normalizeHex(settings.backgroundColor) : "#ffffff";

  return {
    backgroundColor,
    backgroundMode: settings.backgroundMode === "transparent" ? "transparent" : "solid",
    delay: Math.max(120, Math.min(12000, delay)),
    loop: settings.loop !== false,
    size: Math.max(64, Math.min(1600, size)),
  };
}

function applyExportBackground(data: Buffer, settings: GifExportSettings): void {
  const background = hexToRgb(settings.backgroundColor);

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    const pixel = {
      r: data[index],
      g: data[index + 1],
      b: data[index + 2],
    };

    if (alpha < 16 || isBackgroundPixel(pixel)) {
      if (settings.backgroundMode === "transparent") {
        data[index + 3] = 0;
      } else {
        data[index] = background.r;
        data[index + 1] = background.g;
        data[index + 2] = background.b;
        data[index + 3] = 255;
      }
    }
  }
}

async function resizeDecodedGif(
  decoded: DecodedGif,
  settings: GifExportSettings,
): Promise<DecodedGif> {
  const background = hexToRgb(settings.backgroundColor);
  const { data, info } = await sharp(decoded.data, {
    animated: decoded.pages > 1,
    limitInputPixels: false,
    raw: {
      channels: 4,
      height: decoded.height,
      pageHeight: decoded.pageHeight,
      width: decoded.width,
    },
  })
    .resize({
      background: {
        alpha: settings.backgroundMode === "transparent" ? 0 : 1,
        b: background.b,
        g: background.g,
        r: background.r,
      },
      fit: "contain",
      height: settings.size,
      width: settings.size,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frameInfo = info as typeof info & {
    pageHeight?: number;
    pages?: number;
  };
  const pages = frameInfo.pages ?? decoded.pages;
  const pageHeight = frameInfo.pageHeight ?? Math.max(1, Math.round(info.height / pages));

  return {
    ...decoded,
    data,
    height: info.height,
    pageHeight,
    pages,
    width: info.width,
  };
}

function applyExportTiming(decoded: DecodedGif, settings: GifExportSettings): void {
  const sourceDelay = normalizeDelay(decoded.delay, decoded.pages);
  const sourceDuration = sourceDelay.reduce((total, delay) => total + delay, 0);
  const targetDuration = Math.max(120, settings.delay);
  const scale = sourceDuration > 0 ? targetDuration / sourceDuration : 1;

  decoded.delay = sourceDelay.map((delay) => Math.max(20, Math.round(delay * scale)));
  decoded.loop = settings.loop ? 0 : 1;
}

function isBackgroundPixel(pixel: Rgb): boolean {
  const hsl = rgbToHsl(pixel);
  const luminance = getLuminance(pixel.r, pixel.g, pixel.b);

  return luminance > 242 && hsl.s < 0.16;
}

export function createVariantFileName(
  originalFileName: string,
  mode: ExportVariantMode,
  variantId: string,
): string {
  const base = originalFileName.replace(/\.gif$/i, "");
  const suffix = mode === "original" ? "original" : `${mode}-${variantId}`;
  return `${base}-${suffix}.gif`;
}

export function isVariantMode(value: string | null): value is ExportVariantMode {
  return value === "original" || value === "tint" || value === "hue";
}

export function isVariantId(value: string | null): boolean {
  return variantRecipes.some((variant) => variant.id === value);
}

function extractColorSlots(data: Buffer, pixelStride = 1): InternalColorSlot[] {
  const buckets = new Map<string, ColorBucket>();
  const byteStride = Math.max(1, Math.round(pixelStride)) * 4;
  let paintedPixels = 0;

  for (let index = 0; index < data.length; index += byteStride) {
    const alpha = data[index + 3];
    if (alpha < 16) continue;

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const hsl = rgbToHsl({ r, g, b });
    const luminance = getLuminance(r, g, b);

    if (luminance > backgroundLuminance && hsl.s < 0.18) {
      continue;
    }

    paintedPixels += 1;
    const bucket = quantizeRgb({ r, g, b });
    const key = rgbToHex(bucket);
    const current = buckets.get(key);

    if (current) {
      current.r += r;
      current.g += g;
      current.b += b;
      current.count += 1;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  const merged = mergeColorFamilies(mergeBuckets([...buckets.values()].map((bucket) => ({
    r: Math.round(bucket.r / bucket.count),
    g: Math.round(bucket.g / bucket.count),
    b: Math.round(bucket.b / bucket.count),
    count: bucket.count,
  })))).filter((bucket) => bucket.count >= Math.max(140, paintedPixels * 0.002));

  const dark = merged
    .filter((bucket) => isLikelyStrokeColor(bucket))
    .sort((a, b) => b.count - a.count);
  const chromatic = merged
    .filter((bucket) => !isLikelyStrokeColor(bucket))
    .sort((a, b) => b.count - a.count);
  const ordered = [...dark.slice(0, 1), ...chromatic].slice(0, 6);

  return ordered.map((bucket, index) => {
    const rgb = { r: bucket.r, g: bucket.g, b: bucket.b };
    const luminance = getLuminance(rgb.r, rgb.g, rgb.b);

    return {
      id: `color-${index + 1}`,
      hex: rgbToHex(rgb),
      count: bucket.count,
      percentage: paintedPixels === 0 ? 0 : bucket.count / paintedPixels,
      luminance,
      isStroke: index === 0 && isLikelyStrokeColor(bucket),
      rgb,
    };
  });
}

function mergeBuckets(buckets: ColorBucket[]): ColorBucket[] {
  const groups: ColorBucket[] = [];

  for (const bucket of buckets.sort((a, b) => b.count - a.count)) {
    const target = groups.find((group) => colorDistance(group, bucket) < 44);

    if (target) {
      const count = target.count + bucket.count;
      target.r = Math.round((target.r * target.count + bucket.r * bucket.count) / count);
      target.g = Math.round((target.g * target.count + bucket.g * bucket.count) / count);
      target.b = Math.round((target.b * target.count + bucket.b * bucket.count) / count);
      target.count = count;
    } else {
      groups.push({ ...bucket });
    }
  }

  return groups;
}

function mergeColorFamilies(buckets: ColorBucket[]): ColorBucket[] {
  const groups: ColorBucket[] = [];

  for (const bucket of buckets.sort((a, b) => b.count - a.count)) {
    const target = groups.find((group) => shouldMergeColorFamily(group, bucket));

    if (target) {
      mergeBucketInto(target, bucket);
    } else {
      groups.push({ ...bucket });
    }
  }

  return groups;
}

function mergeBucketInto(target: ColorBucket, bucket: ColorBucket): void {
  const count = target.count + bucket.count;
  target.r = Math.round((target.r * target.count + bucket.r * bucket.count) / count);
  target.g = Math.round((target.g * target.count + bucket.g * bucket.count) / count);
  target.b = Math.round((target.b * target.count + bucket.b * bucket.count) / count);
  target.count = count;
}

function shouldMergeColorFamily(a: Rgb, b: Rgb): boolean {
  const aHsl = rgbToHsl(a);
  const bHsl = rgbToHsl(b);
  const aLuminance = getLuminance(a.r, a.g, a.b);
  const bLuminance = getLuminance(b.r, b.g, b.b);

  if (isLikelyNeutralStroke(aHsl, aLuminance) && isLikelyNeutralStroke(bHsl, bLuminance)) {
    return colorDistance(a, b) < 150;
  }

  if (aHsl.s < 0.2 || bHsl.s < 0.2) {
    return colorDistance(a, b) < 62;
  }

  return hueDistance(aHsl.h, bHsl.h) <= 34 && Math.abs(aHsl.s - bHsl.s) <= 0.62;
}

function isLikelyStrokeColor(color: Rgb): boolean {
  const hsl = rgbToHsl(color);
  const luminance = getLuminance(color.r, color.g, color.b);

  return luminance < 82 || isLikelyNeutralStroke(hsl, luminance);
}

function isLikelyNeutralStroke(hsl: Hsl, luminance: number): boolean {
  return hsl.s < 0.26 && luminance < 188;
}

function applyColorReplacements(
  data: Buffer,
  slots: InternalColorSlot[],
  replacements: Map<string, Rgb>,
): void {
  if (slots.length === 0) return;

  const slotReplacements = createSlotReplacementMap(slots, replacements);
  if (slotReplacements.size === 0) return;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 8) continue;

    const pixel = {
      r: data[index],
      g: data[index + 1],
      b: data[index + 2],
    };
    const slot = findNearestSlot(pixel, slots);
    if (!slot || slot.distance > colorDistanceLimit) continue;

    const target = slotReplacements.get(normalizeHex(slot.slot.hex));
    if (!target) continue;

    const shifted = shiftPixelToTarget(pixel, slot.slot.rgb, target);
    data[index] = shifted.r;
    data[index + 1] = shifted.g;
    data[index + 2] = shifted.b;
  }
}

function createSlotReplacementMap(
  slots: InternalColorSlot[],
  replacements: Map<string, Rgb>,
): Map<string, Rgb> {
  const map = new Map<string, Rgb>();
  const replacementEntries = [...replacements.entries()].map(([source, target]) => ({
    source: hexToRgb(source),
    target,
  }));

  for (const slot of slots) {
    const slotHex = normalizeHex(slot.hex);
    const direct = replacements.get(slotHex);

    if (direct) {
      map.set(slotHex, direct);
      continue;
    }

    let nearest: { distance: number; target: Rgb } | null = null;

    for (const replacement of replacementEntries) {
      const distance = colorDistance(slot.rgb, replacement.source);

      if (!nearest || distance < nearest.distance) {
        nearest = { distance, target: replacement.target };
      }
    }

    if (nearest && nearest.distance <= replacementSourceDistanceLimit) {
      map.set(slotHex, nearest.target);
    }
  }

  return map;
}

function createStrokeMask(
  data: Buffer,
  slots: InternalColorSlot[],
  strokeSlot: InternalColorSlot,
): Uint8Array {
  const mask = new Uint8Array(data.length / 4);

  for (let index = 0, pixelIndex = 0; index < data.length; index += 4, pixelIndex += 1) {
    const alpha = data[index + 3];
    if (alpha < 8) continue;

    const pixel = {
      r: data[index],
      g: data[index + 1],
      b: data[index + 2],
    };
    const luminance = getLuminance(pixel.r, pixel.g, pixel.b);
    const slot = findNearestSlot(pixel, slots);
    const strokeDistance = colorDistance(pixel, strokeSlot.rgb);
    const isNearestStroke =
      slot?.slot.id === strokeSlot.id && slot.distance <= 74 && strokeDistance <= 92;
    const isCloseStrokeShade =
      strokeDistance <= 58 && luminance < 130;

    if (isNearestStroke || isCloseStrokeShade) {
      mask[pixelIndex] = 1;
    }
  }

  return mask;
}

function applyStrokeWeight(
  data: Buffer,
  strokeMask: Uint8Array,
  decoded: DecodedGif,
  stroke: StrokeWeight,
): void {
  for (let pixelIndex = 0; pixelIndex < strokeMask.length; pixelIndex += 1) {
    if (!strokeMask[pixelIndex]) continue;

    const dataIndex = pixelIndex * 4;
    const toned = toneStrokePixel(
      {
        r: data[dataIndex],
        g: data[dataIndex + 1],
        b: data[dataIndex + 2],
      },
      stroke,
    );

    data[dataIndex] = toned.r;
    data[dataIndex + 1] = toned.g;
    data[dataIndex + 2] = toned.b;
  }

  if (stroke === "bold") {
    expandBoldStroke(data, strokeMask, decoded);
  }
}

function toneStrokePixel(pixel: Rgb, stroke: StrokeWeight): Rgb {
  const hsl = rgbToHsl(pixel);
  const luminance = getLuminance(pixel.r, pixel.g, pixel.b);
  const isNeutralDark = hsl.s < 0.22 && luminance < 132;
  const isNeutralStroke = hsl.s < 0.3 && luminance < 210;

  if (stroke === "light") {
    if (isNeutralDark) {
      return mixRgb(pixel, { r: 120, g: 132, b: 160 }, 0.95);
    }

    return hslToRgb({
      h: hsl.h,
      s: clamp(hsl.s * 0.9, 0, 1),
      l: clamp(hsl.l + 0.25, 0.04, 0.96),
    });
  }

  if (stroke === "regular") {
    if (isNeutralStroke) {
      return mixRgb(pixel, { r: 0, g: 2, b: 18 }, isNeutralDark ? 0.38 : 0.28);
    }

    return hslToRgb({
      h: hsl.h,
      s: clamp(hsl.s * 1.04, 0, 1),
      l: clamp(hsl.l - 0.045, 0.02, 0.94),
    });
  }

  if (isNeutralStroke) {
    return mixRgb(pixel, { r: 0, g: 0, b: 0 }, isNeutralDark ? 1 : 0.76);
  }

  return hslToRgb({
    h: hsl.h,
    s: clamp(hsl.s * 1.16, 0, 1),
    l: clamp(hsl.l - 0.28, 0.02, 0.94),
  });
}

function expandBoldStroke(
  data: Buffer,
  strokeMask: Uint8Array,
  decoded: DecodedGif,
): void {
  const source = Buffer.from(data);
  const { width, pageHeight, pages } = decoded;

  for (let page = 0; page < pages; page += 1) {
    const pageOffset = page * width * pageHeight;

    for (let y = 0; y < pageHeight; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = pageOffset + y * width + x;
        if (!strokeMask[pixelIndex]) continue;

        const sourceIndex = pixelIndex * 4;
        const strokeColor = {
          r: source[sourceIndex],
          g: source[sourceIndex + 1],
          b: source[sourceIndex + 2],
        };

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;

            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > Math.SQRT2) {
              continue;
            }

            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= pageHeight) continue;

            const targetPixelIndex = pageOffset + ny * width + nx;
            if (strokeMask[targetPixelIndex]) continue;

            const targetIndex = targetPixelIndex * 4;
            const targetAlpha = source[targetIndex + 3];
            const targetPixel = {
              r: source[targetIndex],
              g: source[targetIndex + 1],
              b: source[targetIndex + 2],
            };

            if (!canReceiveBoldStroke(targetPixel, targetAlpha)) continue;

            const amount = distance <= 1 ? 0.88 : 0.54;
            const blended = mixRgb(targetPixel, strokeColor, amount);
            data[targetIndex] = blended.r;
            data[targetIndex + 1] = blended.g;
            data[targetIndex + 2] = blended.b;
          }
        }
      }
    }
  }
}

function canReceiveBoldStroke(pixel: Rgb, alpha: number): boolean {
  if (alpha < 64) return false;
  if (isBackgroundPixel(pixel)) return true;

  return true;
}

function mixRgb(source: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: Math.round(source.r * (1 - amount) + target.r * amount),
    g: Math.round(source.g * (1 - amount) + target.g * amount),
    b: Math.round(source.b * (1 - amount) + target.b * amount),
  };
}

function createReplacementMap(colors: GifColorReplacement[]): Map<string, Rgb> {
  const map = new Map<string, Rgb>();

  for (const color of colors) {
    if (!isHexColor(color.source) || !isHexColor(color.target)) continue;
    map.set(normalizeHex(color.source), hexToRgb(color.target));
  }

  return map;
}

function normalizeStroke(stroke: StrokeWeight): StrokeWeight {
  return stroke === "light" || stroke === "bold" ? stroke : "regular";
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function quantizeRgb({ r, g, b }: Rgb): Rgb {
  const step = 24;

  return {
    r: Math.min(255, Math.round(r / step) * step),
    g: Math.min(255, Math.round(g / step) * step),
    b: Math.min(255, Math.round(b / step) * step),
  };
}

function findNearestSlot(pixel: Rgb, slots: InternalColorSlot[]) {
  let nearest: { distance: number; slot: InternalColorSlot } | null = null;

  for (const slot of slots) {
    const distance = colorDistance(pixel, slot.rgb);
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, slot };
    }
  }

  return nearest;
}

function shiftPixelToTarget(pixel: Rgb, source: Rgb, target: Rgb): Rgb {
  const sourceHsl = rgbToHsl(source);
  const pixelHsl = rgbToHsl(pixel);
  const targetHsl = rgbToHsl(target);
  const lightnessDelta = pixelHsl.l - sourceHsl.l;

  return hslToRgb({
    h: targetHsl.h,
    s: Math.max(targetHsl.s, pixelHsl.s * 0.5),
    l: clamp(targetHsl.l + lightnessDelta, 0.02, 0.98),
  });
}

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;

  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function getLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rp = r / 255;
  const gp = g / 255;
  const bp = b / 255;
  const max = Math.max(rp, gp, bp);
  const min = Math.min(rp, gp, bp);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let hue = 0;

  if (max === rp) {
    hue = 60 * (((gp - bp) / delta) % 6);
  } else if (max === gp) {
    hue = 60 * ((bp - rp) / delta + 2);
  } else {
    hue = 60 * ((rp - gp) / delta + 4);
  }

  return { h: hue < 0 ? hue + 360 : hue, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
