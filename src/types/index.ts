export type GifSourceMode = "archive" | "demo";

export interface GifItem {
  id: string;
  title: string;
  fileName: string;
  src: string;
  category: string;
  bytes: number;
  updatedAt: string;
  origin: GifSourceMode;
}

export interface GifCatalogSource {
  mode: GifSourceMode;
  rootLabel: string;
  usesFileProxy: boolean;
  scannedAt: string;
}

export interface GifCatalogResponse {
  categories: GifCategorySummary[];
  category: string;
  items: GifItem[];
  total: number;
  offset: number;
  limit: number;
  query: string;
  source: GifCatalogSource;
}

export interface GifCategorySummary {
  count: number;
  name: string;
}

export interface GifCollection {
  id: string;
  itemIds: string[];
  name: string;
}

export interface GifCollectionStore {
  activeCollectionId: string;
  collections: GifCollection[];
  itemsById: Record<string, GifItem>;
  updatedAt: string;
}

export interface CatalogQuery {
  category?: string;
  refresh?: boolean;
  query?: string;
  offset?: number;
  limit?: number;
}

export type GifIndexPhase = "idle" | "discovering" | "indexing" | "warming" | "writing" | "ready" | "error";

export interface GifIndexStatus {
  completedAt: string;
  currentPath: string;
  discoveredFiles: number;
  durationMs: number;
  error: string;
  indexedFiles: number;
  message: string;
  pendingDirectories: number;
  phase: GifIndexPhase;
  progress: number;
  rootLabel: string;
  running: boolean;
  scannedDirectories: number;
  startedAt: string;
  totalFiles: number;
  updatedAt: string;
}

export interface GifIndexSummary {
  cacheTtlMs: number;
  count: number;
  exists: boolean;
  rootLabel: string;
  scannedAt: string;
  stale: boolean;
  usesFileProxy: boolean;
}

export interface GifIndexStatusResponse {
  status: GifIndexStatus;
  summary: GifIndexSummary;
}

export interface VariantRecipe {
  id: string;
  name: string;
  hex: string;
  tintFilter: string;
  hueFilter: string;
  shadow: string;
}

export type StrokeWeight = "light" | "regular" | "bold";

export interface GifColorSlot {
  id: string;
  hex: string;
  count: number;
  percentage: number;
  luminance: number;
  isStroke: boolean;
}

export interface GifColorAnalysis {
  itemId: string;
  colors: GifColorSlot[];
  stroke: StrokeWeight;
}

export interface GifPreviewFrameData {
  data: string;
  delay: number[];
  itemId: string;
  pageHeight: number;
  pages: number;
  width: number;
}

export interface GifColorReplacement {
  source: string;
  target: string;
}

export type GifBackgroundMode = "solid" | "transparent";

export interface GifExportSettings {
  backgroundColor: string;
  backgroundMode: GifBackgroundMode;
  delay: number;
  loop: boolean;
  size: number;
}

export interface GifEditorRequest {
  colors: GifColorReplacement[];
  export?: GifExportSettings;
  stroke: StrokeWeight;
}
