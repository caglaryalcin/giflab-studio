/* eslint-disable @next/next/no-img-element */
"use client";

import {
  Activity,
  ChevronUp,
  Download,
  ExternalLink,
  Grid3X3,
  HelpCircle,
  ListFilter,
  Minus,
  Moon,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  GifCatalogResponse,
  GifCategorySummary,
  GifCollection,
  GifCollectionStore,
  GifBackgroundMode,
  GifColorAnalysis,
  GifColorReplacement,
  GifColorSlot,
  GifEditorRequest,
  GifExportSettings,
  GifItem,
  GifPreviewFrameData,
  StrokeWeight,
  VariantRecipe,
} from "@/types";

type Density = "comfortable" | "compact";
type ThemeMode = "light" | "dark";
type CollectionSyncState = "loading" | "saving" | "saved" | "error";
type CollectionDialogMode = "add" | "create";
type CatalogPageRequest = {
  append: boolean;
  category: string;
  cacheKey?: string;
  forceRefresh?: boolean;
  offset: number;
  queryText: string;
  signal?: AbortSignal;
};

type CatalogPageCacheEntry = {
  categories: GifCategorySummary[];
  items: GifItem[];
  total: number;
};

type GifArchiveAppProps = {
  initialCategories?: GifCategorySummary[];
  initialItems: GifItem[];
  initialTotal?: number;
  variants: VariantRecipe[];
};

const strokeOptions: StrokeWeight[] = ["light", "regular", "bold"];
const colorPickerPalette = [
  "#fee2e2",
  "#fecaca",
  "#fda4af",
  "#f0abfc",
  "#c4b5fd",
  "#93c5fd",
  "#bae6fd",
  "#a7f3d0",
  "#bbf7d0",
  "#fef08a",
  "#fde68a",
  "#fed7aa",
  "#fca5a5",
  "#f87171",
  "#fb7185",
  "#e879f9",
  "#a78bfa",
  "#60a5fa",
  "#67e8f9",
  "#34d399",
  "#4ade80",
  "#fde047",
  "#fbbf24",
  "#fb923c",
  "#ef4444",
  "#dc2626",
  "#be123c",
  "#c026d3",
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#16a34a",
  "#ca8a04",
  "#d97706",
  "#ea580c",
  "#991b1b",
  "#7f1d1d",
  "#701a75",
  "#581c87",
  "#1e3a8a",
  "#164e63",
  "#064e3b",
  "#14532d",
  "#713f12",
  "#7c2d12",
  "#431407",
  "#0f172a",
  "#1f2937",
  "#374151",
  "#4b5563",
  "#64748b",
  "#94a3b8",
  "#cbd5e1",
  "#e5e7eb",
  "#f8fafc",
];
const clientAnalysisCacheLimit = 80;
const clientPreviewCacheLimit = 20;
const catalogPageSize = 120;

export function GifArchiveApp({ initialCategories, initialItems, initialTotal }: GifArchiveAppProps) {
  const [items, setItems] = useState<GifItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal ?? initialItems.length);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [categories, setCategories] = useState<GifCategorySummary[]>(
    () => initialCategories ?? createCategorySummaries(initialItems),
  );
  const [selectedId, setSelectedId] = useState("");
  const [collections, setCollections] = useState<GifCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState("");
  const [collectionDialogItem, setCollectionDialogItem] = useState<GifItem | null>(null);
  const [collectionDialogMode, setCollectionDialogMode] = useState<CollectionDialogMode>("add");
  const [collectionDraftName, setCollectionDraftName] = useState("");
  const [collectionItemsById, setCollectionItemsById] = useState<Record<string, GifItem>>({});
  const [showCollectionOnly, setShowCollectionOnly] = useState(false);
  const [collectionEditorOpen, setCollectionEditorOpen] = useState(false);
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);
  const [, setCollectionSyncState] = useState<CollectionSyncState>("loading");
  const [collectionSyncError, setCollectionSyncError] = useState("");
  const [density, setDensity] = useState<Density>("comfortable");
  const [animatedCardId, setAnimatedCardId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);
  const [bulkExportOpen, setBulkExportOpen] = useState(false);
  const [bulkExportIndex, setBulkExportIndex] = useState(0);
  const [error, setError] = useState("");
  const [colorSlots, setColorSlots] = useState<GifColorSlot[]>([]);
  const [colorTargets, setColorTargets] = useState<Record<string, string>>({});
  const [activeColor, setActiveColor] = useState("");
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [stroke, setStroke] = useState<StrokeWeight>("regular");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [previewFrames, setPreviewFrames] = useState<GifPreviewFrameData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [photoBackdropEnabled, setPhotoBackdropEnabled] = useState(false);
  const [photoPreviewPlaying, setPhotoPreviewPlaying] = useState(true);
  const [photoPreviewProgress, setPhotoPreviewProgress] = useState(0);
  const [photoPreviewSeek, setPhotoPreviewSeek] = useState({ progress: 0, version: 0 });
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [exportBackgroundMode, setExportBackgroundMode] = useState<GifBackgroundMode>("solid");
  const [exportBackgroundColor, setExportBackgroundColor] = useState("#ffffff");
  const [exportDelay, setExportDelay] = useState(2000);
  const [exportLoop, setExportLoop] = useState(true);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const analysisCacheRef = useRef(new Map<string, GifColorAnalysis>());
  const previewCacheRef = useRef(new Map<string, GifPreviewFrameData>());
  const collectionsLoadedRef = useRef(false);
  const catalogReplaceRequestIdRef = useRef(0);
  const catalogAppendRequestIdRef = useRef(0);
  const catalogReplaceInFlightRef = useRef(false);
  const catalogAppendInFlightRef = useRef(false);
  const catalogPageCacheRef = useRef(new Map<string, CatalogPageCacheEntry>());
  const skipInitialCatalogRequestRef = useRef(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const skipNextCollectionSaveRef = useRef(false);
  const photoSeekDraggingRef = useRef(false);

  const requestCatalogPage = useCallback(async ({
    append,
    category,
    cacheKey,
    forceRefresh = false,
    offset,
    queryText,
    signal,
  }: CatalogPageRequest) => {
    if (append && (catalogReplaceInFlightRef.current || catalogAppendInFlightRef.current)) {
      return;
    }

    const requestId = append
      ? catalogAppendRequestIdRef.current + 1
      : catalogReplaceRequestIdRef.current + 1;

    if (append) {
      catalogAppendRequestIdRef.current = requestId;
      catalogAppendInFlightRef.current = true;
    } else {
      catalogReplaceRequestIdRef.current = requestId;
      catalogReplaceInFlightRef.current = true;
      catalogAppendRequestIdRef.current += 1;
      catalogAppendInFlightRef.current = false;
      setLoadingMore(false);
    }

    const isCurrentRequest = () =>
      append
        ? requestId === catalogAppendRequestIdRef.current && !catalogReplaceInFlightRef.current
        : requestId === catalogReplaceRequestIdRef.current;

    if (!append && !forceRefresh && cacheKey) {
      const cachedPage = catalogPageCacheRef.current.get(cacheKey);

      if (cachedPage) {
        setItems(cachedPage.items);
        setCategories(cachedPage.categories);
        setTotal(cachedPage.total);
        setLoading(false);
        setLoadingMore(false);
        setError("");
        catalogReplaceInFlightRef.current = false;
        return;
      }
    }

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setLoadingMore(false);
    }

    setError("");

    try {
      const params = new URLSearchParams({
        limit: String(catalogPageSize),
        offset: String(offset),
      });

      if (queryText) params.set("query", queryText);
      if (category) params.set("category", category);
      if (forceRefresh) params.set("refresh", "1");

      const response = await fetch(`/api/gifs?${params.toString()}`, {
        signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Catalog request failed: ${response.status}`);
      }

      const data = (await response.json()) as GifCatalogResponse;

      if (signal?.aborted || !isCurrentRequest()) return;

      setItems((currentItems) =>
        append ? mergeCatalogItems(currentItems, data.items) : data.items,
      );
      const nextCategories = readCatalogCategories(data, data.items);
      setCategories(nextCategories);
      setTotal(data.total);

      if (!append && !forceRefresh && cacheKey) {
        rememberCatalogPage(
          catalogPageCacheRef.current,
          cacheKey,
          {
            categories: nextCategories,
            items: data.items,
            total: data.total,
          },
        );
      }
    } catch (requestError) {
      if (!signal?.aborted && isCurrentRequest()) {
        setError(requestError instanceof Error ? requestError.message : "Catalog request failed");
      }
    } finally {
      if (!signal?.aborted && isCurrentRequest()) {
        if (append) {
          catalogAppendInFlightRef.current = false;
          setLoadingMore(false);
        } else {
          catalogReplaceInFlightRef.current = false;
          setLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("giflab-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(storedTheme === "dark" || (!storedTheme && prefersDark) ? "dark" : "light");
  }, []);

  useEffect(() => {
    document.body.dataset.gifTheme = theme;
    window.localStorage.setItem("giflab-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!colorPickerOpen) return undefined;

    function closeColorPicker(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && colorPickerRef.current?.contains(target)) return;
      setColorPickerOpen(false);
    }

    document.addEventListener("pointerdown", closeColorPicker);

    return () => {
      document.removeEventListener("pointerdown", closeColorPicker);
    };
  }, [colorPickerOpen]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCollections() {
      setCollectionSyncState("loading");
      setCollectionSyncError("");

      try {
        const response = await fetch("/api/collections", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Collections request failed: ${response.status}`);
        }

        const data = (await response.json()) as GifCollectionStore;
        skipNextCollectionSaveRef.current = true;
        setCollections(data.collections);
        setCollectionItemsById(data.itemsById);
        setActiveCollectionId(
          data.collections.some((collection) => collection.id === data.activeCollectionId)
            ? data.activeCollectionId
            : data.collections[0]?.id ?? "",
        );
        setCollectionSyncState("saved");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setCollectionSyncState("error");
          setCollectionSyncError(
            requestError instanceof Error ? requestError.message : "Collections request failed",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          collectionsLoadedRef.current = true;
        }
      }
    }

    void loadCollections();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!collectionsLoadedRef.current) return;
    if (skipNextCollectionSaveRef.current) {
      skipNextCollectionSaveRef.current = false;
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCollectionSyncState("saving");
      setCollectionSyncError("");

      try {
        const response = await fetch("/api/collections", {
          body: JSON.stringify(createCollectionStoreSnapshot(collections, collectionItemsById, activeCollectionId)),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          method: "PUT",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Collections save failed: ${response.status}`);
        }

        setCollectionSyncState("saved");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setCollectionSyncState("error");
          setCollectionSyncError(
            requestError instanceof Error ? requestError.message : "Collections save failed",
          );
        }
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeCollectionId, collectionItemsById, collections]);

  useEffect(() => {
    if (skipInitialCatalogRequestRef.current && !activeCategory && !query.trim()) {
      skipInitialCatalogRequestRef.current = false;
      return undefined;
    }

    skipInitialCatalogRequestRef.current = false;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      await requestCatalogPage({
        append: false,
        category: activeCategory,
        cacheKey: createCatalogPageCacheKey(activeCategory, query.trim()),
        offset: 0,
        queryText: query.trim(),
        signal: controller.signal,
      });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeCategory, query, requestCatalogPage]);

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId) ?? null,
    [activeCollectionId, collections],
  );

  const collectionItems = useMemo(
    () =>
      (activeCollection?.itemIds ?? []).flatMap((id) => {
        const item = collectionItemsById[id] ?? items.find((candidate) => candidate.id === id);
        return item ? [item] : [];
      }),
    [activeCollection, collectionItemsById, items],
  );
  const bulkExportableItems = useMemo(
    () => collectionItems.filter((item) => item.origin === "archive"),
    [collectionItems],
  );
  const bulkExportTotal = bulkExportableItems.length;
  const bulkExportPercent =
    bulkExportTotal > 0 ? Math.min(100, Math.round((bulkExportIndex / bulkExportTotal) * 100)) : 0;
  const collectionIdSet = useMemo(
    () => new Set(collections.flatMap((collection) => collection.itemIds)),
    [collections],
  );
  const visibleItems = showCollectionOnly && activeCollection ? collectionItems : items;
  const canLoadMore = !showCollectionOnly && items.length < total;
  const activeCategoryCount = categories.find((category) => category.name === activeCategory)?.count ?? total;

  const loadMoreCatalog = useCallback(() => {
    if (!canLoadMore || loading || loadingMore) return;

    void requestCatalogPage({
      append: true,
      category: activeCategory,
      offset: items.length,
      queryText: query.trim(),
    });
  }, [activeCategory, canLoadMore, items.length, loading, loadingMore, query, requestCatalogPage]);

  useEffect(() => {
    const target = loadMoreRef.current;

    if (!target || !canLoadMore || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreCatalog();
        }
      },
      {
        rootMargin: "520px 0px",
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, loadMoreCatalog]);

  const selectedItem = useMemo(() => {
    if (!selectedId) return null;

    return (
      visibleItems.find((item) => item.id === selectedId) ??
      collectionItemsById[selectedId] ??
      items.find((item) => item.id === selectedId) ??
      initialItems.find((item) => item.id === selectedId) ??
      null
    );
  }, [collectionItemsById, initialItems, items, selectedId, visibleItems]);

  useEffect(() => {
    const analysisItem = selectedItem;

    if (!analysisItem || analysisItem.origin !== "archive") {
      setColorSlots([]);
      setColorTargets({});
      setActiveColor("");
      setColorPickerOpen(false);
      setStroke("regular");
      setAnalysisLoading(false);
      return;
    }

    const analysisRequestItem: GifItem = analysisItem;
    const analysisCacheKey = createGifProcessingCacheKey(analysisRequestItem);
    const cachedAnalysis = analysisCacheRef.current.get(analysisCacheKey);

    function applyAnalysis(data: GifColorAnalysis) {
      const nextTargets = createColorTargetMap(data.colors);
      setColorSlots(data.colors);
      setColorTargets(nextTargets);
      setActiveColor(normalizeHex(data.colors[0]?.hex ?? ""));
    }

    setError("");
    setStroke("regular");

    if (cachedAnalysis) {
      applyAnalysis(cachedAnalysis);
      setAnalysisLoading(false);
      return;
    }

    const controller = new AbortController();
    setAnalysisLoading(true);

    async function loadAnalysis() {
      try {
        const response = await fetch(createGifProcessingUrl("analyze", analysisRequestItem), {
          cache: "force-cache",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Color scan failed: ${response.status}`);
        }

        const data = (await response.json()) as GifColorAnalysis;
        rememberClientCache(
          analysisCacheRef.current,
          analysisCacheKey,
          data,
          clientAnalysisCacheLimit,
        );
        applyAnalysis(data);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setColorSlots([]);
          setColorTargets({});
          setActiveColor("");
          setColorPickerOpen(false);
          setError(requestError instanceof Error ? requestError.message : "Color scan failed");
        }
      } finally {
        if (!controller.signal.aborted) {
          setAnalysisLoading(false);
        }
      }
    }

    void loadAnalysis();

    return () => {
      controller.abort();
    };
  }, [selectedItem]);

  useEffect(() => {
    const previewItem = selectedItem;

    if (!previewItem || previewItem.origin !== "archive") {
      setPreviewFrames(null);
      setPreviewLoading(false);
      return;
    }

    const previewRequestItem: GifItem = previewItem;
    const previewCacheKey = createGifProcessingCacheKey(previewRequestItem);
    const cachedPreview = previewCacheRef.current.get(previewCacheKey);

    if (cachedPreview) {
      setPreviewFrames(cachedPreview);
      setPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    setPreviewFrames(null);
    setPreviewLoading(true);

    async function loadPreviewFrames() {
      try {
        const response = await fetch(createGifProcessingUrl("preview", previewRequestItem), {
          cache: "force-cache",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Preview setup failed: ${response.status}`);
        }

        const data = (await response.json()) as GifPreviewFrameData;
        rememberClientCache(
          previewCacheRef.current,
          previewCacheKey,
          data,
          clientPreviewCacheLimit,
        );
        setPreviewFrames(data);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setPreviewFrames(null);
          setError(requestError instanceof Error ? requestError.message : "Preview setup failed");
        }
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      }
    }

    void loadPreviewFrames();

    return () => {
      controller.abort();
    };
  }, [selectedItem]);

  useEffect(() => {
    if (!previewFrames) return;
    setExportDelay(getPreviewDuration(previewFrames));
  }, [previewFrames]);

  useEffect(() => {
    setPhotoPreviewPlaying(true);
    setPhotoPreviewProgress(0);
    setPhotoPreviewSeek((current) => ({ progress: 0, version: current.version + 1 }));
  }, [selectedItem?.id, previewFrames]);

  const editorPayload = useMemo(
    () => createEditorPayload(colorSlots, colorTargets, stroke),
    [colorSlots, colorTargets, stroke],
  );
  const hasEditorChanges = editorPayload.colors.length > 0 || stroke !== "regular";
  const exportSettings = useMemo<GifExportSettings>(
    () => ({
      backgroundColor: exportBackgroundColor,
      backgroundMode: exportBackgroundMode,
      delay: exportDelay,
      loop: exportLoop,
      size: 400,
    }),
    [exportBackgroundColor, exportBackgroundMode, exportDelay, exportLoop],
  );
  const photoPreviewProgressStyle = useMemo(
    () =>
      ({
        "--preview-progress": `${Math.round(photoPreviewProgress * 1000) / 10}%`,
      }) as CSSProperties,
    [photoPreviewProgress],
  );

  const canEditSelected = Boolean(selectedItem && selectedItem.origin === "archive");
  const canExportVariant = canEditSelected && colorSlots.length > 0 && !analysisLoading;
  const activeSlot = useMemo(
    () => colorSlots.find((slot) => normalizeHex(slot.hex) === activeColor) ?? colorSlots[0],
    [activeColor, colorSlots],
  );
  const activeTarget = activeSlot
    ? colorTargets[normalizeHex(activeSlot.hex)] ?? activeSlot.hex
    : "#121330";
  const previewImageSrc = selectedItem?.src || "";

  function seekPhotoPreview(nextProgress: number) {
    const progress = Math.max(0, Math.min(1, nextProgress));

    setPhotoPreviewProgress(progress);
    setPhotoPreviewSeek((current) => ({
      progress,
      version: current.version + 1,
    }));
  }

  function getPhotoSeekProgress(clientX: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();

    if (rect.width <= 0) return photoPreviewProgress;

    return (clientX - rect.left) / rect.width;
  }

  function handlePhotoSeekPointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!previewFrames) return;

    event.preventDefault();
    photoSeekDraggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekPhotoPreview(getPhotoSeekProgress(event.clientX, event.currentTarget));
  }

  function handlePhotoSeekPointerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!previewFrames || !photoSeekDraggingRef.current) {
      return;
    }

    event.preventDefault();
    seekPhotoPreview(getPhotoSeekProgress(event.clientX, event.currentTarget));
  }

  function stopPhotoSeekPointer() {
    photoSeekDraggingRef.current = false;
  }

  function handlePhotoSeekKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (!previewFrames) return;

    const step = event.shiftKey ? 0.1 : 0.03;
    let nextProgress: number | null = null;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextProgress = photoPreviewProgress - step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextProgress = photoPreviewProgress + step;
    } else if (event.key === "Home") {
      nextProgress = 0;
    } else if (event.key === "End") {
      nextProgress = 1;
    }

    if (nextProgress === null) return;

    event.preventDefault();
    seekPhotoPreview(nextProgress);
  }

  function openCollectionDialog(item: GifItem) {
    setCollectionDialogItem(item);
    setCollectionDialogMode("add");
    setCollectionDraftName("");
  }

  function closeCollectionDialog() {
    setCollectionDialogItem(null);
    setCollectionDialogMode("add");
    setCollectionDraftName("");
  }

  function createCollectionFromDialog() {
    const name = collectionDraftName.trim();
    if (!name) return;

    const id = `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setCollections((current) => [...current, { id, itemIds: [], name }]);
    setActiveCollectionId(id);
    setCollectionEditorOpen(false);
    closeCollectionDialog();
  }

  function addItemsToCollection(itemsToAdd: GifItem[], collectionId: string) {
    if (!collectionId || itemsToAdd.length === 0) return;

    const idsToAdd = itemsToAdd.map((item) => item.id);

    setCollectionItemsById((current) => {
      const next = { ...current };

      for (const item of itemsToAdd) {
        next[item.id] = item;
      }

      return next;
    });
    setCollections((current) =>
      current.map((collection) => {
        if (collection.id !== collectionId) return collection;

        return {
          ...collection,
          itemIds: Array.from(new Set([...collection.itemIds, ...idsToAdd])),
        };
      }),
    );
    setActiveCollectionId(collectionId);
    setShowCollectionOnly(true);
    setCollectionEditorOpen(false);
  }

  function addDialogItemToCollection(collectionId: string) {
    if (!collectionDialogItem) return;
    addItemsToCollection([collectionDialogItem], collectionId);
    closeCollectionDialog();
  }

  function deleteCollection(collectionId: string) {
    const collection = collections.find((candidate) => candidate.id === collectionId);
    if (!collection) return;

    const title = formatCollectionTitle(collection.name);
    const shouldDelete = window.confirm(`Delete "${title}" collection? GIF files will stay in archive.`);
    if (!shouldDelete) return;

    const deletedIndex = collections.findIndex((candidate) => candidate.id === collectionId);
    const nextCollections = collections.filter((candidate) => candidate.id !== collectionId);
    const nextActiveCollectionId =
      nextCollections[Math.min(deletedIndex, nextCollections.length - 1)]?.id ?? "";

    setCollections(nextCollections);
    setCollectionItemsById((current) => {
      const usedIds = new Set(nextCollections.flatMap((candidate) => candidate.itemIds));
      const nextItemsById: Record<string, GifItem> = {};

      for (const id of usedIds) {
        const item = current[id];
        if (item) nextItemsById[id] = item;
      }

      return nextItemsById;
    });

    if (activeCollectionId === collectionId) {
      setActiveCollectionId(nextActiveCollectionId);
      setShowCollectionOnly(Boolean(nextActiveCollectionId));
      setCollectionEditorOpen(false);
      setBulkExportOpen(false);
    }
  }

  function updateActiveColor(target: string) {
    if (!activeSlot) return;

    const cleanTarget = target.trim();
    const nextTarget = normalizeHex(cleanTarget.startsWith("#") ? cleanTarget : `#${cleanTarget}`);
    if (!isHexColor(nextTarget)) return;

    setColorTargets((current) => ({
      ...current,
      [normalizeHex(activeSlot.hex)]: nextTarget,
    }));
  }

  function resetEditorColors() {
    const nextTargets = createColorTargetMap(colorSlots);
    setColorTargets(nextTargets);
    setActiveColor(normalizeHex(colorSlots[0]?.hex ?? ""));
    setColorPickerOpen(false);
    setStroke("regular");
    setError("");
  }

  async function downloadVariantGif() {
    if (!selectedItem || !canExportVariant) return;

    setExporting(true);
    setError("");

    try {
      const response = await fetch(`/api/gifs/variant/${selectedItem.id}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...editorPayload,
          export: exportSettings,
        }),
      });

      if (!response.ok) {
        throw new Error(`Variant export failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = createEditorFileName(selectedItem.fileName, stroke);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Variant export failed");
    } finally {
      setExporting(false);
    }
  }

  async function downloadBulkExportGifs() {
    if (!activeCollection || collectionItems.length === 0) return;

    setBulkExporting(true);
    setBulkExportIndex(0);
    setError("");

    try {
      const archiveItems = bulkExportableItems;
      if (archiveItems.length === 0) {
        throw new Error("Bulk export needs archive GIFs");
      }

      for (const [index, item] of archiveItems.entries()) {
        const response = await fetch(`/api/gifs/variant/${item.id}`, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            colors: [],
            export: exportSettings,
            stroke: "regular",
          } satisfies GifEditorRequest),
        });

        if (!response.ok) {
          throw new Error(`Bulk export failed: ${response.status}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = createBulkExportFileName(item.fileName);
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        setBulkExportIndex(index + 1);
        await waitForDownloadQueue();
      }

      setBulkExportOpen(false);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Bulk export failed");
    } finally {
      setBulkExporting(false);
      setBulkExportIndex(0);
    }
  }

  return (
    <div className="gif-app" data-theme={theme}>
      <header className="gif-topbar">
        <Link className="gif-brand" href="/" aria-label="GifLab Studio">
          <span className="gif-brand__mark">
            <Sparkles size={20} strokeWidth={2.4} />
          </span>
          <span>
            <strong>GifLab</strong>
            <small>Studio</small>
          </span>
        </Link>

        <div className="gif-topbar__right">
          <div className="gif-toolbar gif-toolbar--topbar" aria-label="Catalog view controls">
            <button
              className={density === "comfortable" ? "is-active" : ""}
              onClick={() => setDensity("comfortable")}
              title="Comfortable grid"
              type="button"
            >
              <Grid3X3 size={18} />
              <span>Comfort</span>
            </button>
            <button
              className={density === "compact" ? "is-active" : ""}
              onClick={() => setDensity("compact")}
              title="Compact grid"
              type="button"
            >
              <ListFilter size={18} />
              <span>Compact</span>
            </button>
            <button
              aria-label="Refresh catalog"
              className="gif-square-button"
              onClick={() => {
                catalogPageCacheRef.current.clear();
                void requestCatalogPage({
                  append: false,
                  category: activeCategory,
                  forceRefresh: true,
                  offset: 0,
                  queryText: query.trim(),
                });
              }}
              title="Refresh catalog"
              type="button"
            >
              <RefreshCw className={loading ? "is-spinning" : ""} size={18} />
            </button>
            <Link className="gif-topbar-link" href="/status" title="Archive status">
              <Activity size={17} />
              <span>Status</span>
            </Link>
          </div>
          <button
            aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
            className="gif-square-button gif-theme-toggle"
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            type="button"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="gif-workspace" id="archive">
        <div className={showCollectionOnly && !collectionEditorOpen ? "gif-shell is-collection-view" : "gif-shell"}>
          <aside className="gif-sidebar" aria-label="Collections">
            <label className="gif-search gif-search--sidebar">
              <Search size={20} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search..."
                type="search"
              />
              {query ? (
                <button
                  aria-label="Clear search"
                  className="gif-icon-button"
                  onClick={() => setQuery("")}
                  title="Clear search"
                  type="button"
                >
                  <X size={17} />
                </button>
              ) : (
                <small>^+K</small>
              )}
            </label>

            <button
              className={!showCollectionOnly && !activeCategory ? "gif-sidebar-link is-active" : "gif-sidebar-link"}
              onClick={() => {
                setActiveCategory("");
                setShowCollectionOnly(false);
                setCollectionEditorOpen(false);
              }}
              type="button"
            >
              <Grid3X3 size={17} />
              <span>All GIFs</span>
              <small>{formatNumber(total)}</small>
            </button>

            <div className="gif-sidebar-section">
              <span className="gif-sidebar-section__header">Categories</span>
              {categories.length > 0 ? (
                <div className="gif-sidebar-categories" aria-label="GIF categories">
                  <button
                    className={!activeCategory ? "gif-sidebar-category is-active" : "gif-sidebar-category"}
                    onClick={() => {
                      setActiveCategory("");
                      setShowCollectionOnly(false);
                      setCollectionEditorOpen(false);
                    }}
                    type="button"
                  >
                    <span>All categories</span>
                    <small>{formatNumber(categories.reduce((sum, category) => sum + category.count, 0))}</small>
                  </button>
                  {categories.map((category) => (
                    <button
                      className={
                        activeCategory === category.name
                          ? "gif-sidebar-category is-active"
                          : "gif-sidebar-category"
                      }
                      key={category.name}
                      onClick={() => {
                        setActiveCategory(category.name);
                        setShowCollectionOnly(false);
                        setCollectionEditorOpen(false);
                      }}
                      type="button"
                    >
                      <span>{category.name}</span>
                      <small>{formatNumber(category.count)}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="gif-collection-empty">No categories yet.</p>
              )}
            </div>

            <div className="gif-sidebar-section">
              <button
                aria-controls="gif-sidebar-collections"
                aria-expanded={collectionsExpanded}
                className="gif-sidebar-section__header"
                onClick={() => setCollectionsExpanded((value) => !value)}
                type="button"
              >
                <span>Collections</span>
                <ChevronUp
                  className={
                    collectionsExpanded
                      ? "gif-sidebar-section__chevron"
                      : "gif-sidebar-section__chevron is-collapsed"
                  }
                  size={18}
                />
              </button>
              {collectionsExpanded ? (
                collections.length > 0 ? (
                  <div className="gif-sidebar-collections" id="gif-sidebar-collections">
                    {collections.map((collection) => (
                      <div className="gif-sidebar-collection-row" key={collection.id}>
                        <button
                          className={
                            showCollectionOnly && collection.id === activeCollectionId
                              ? "gif-sidebar-collection-main is-active"
                              : "gif-sidebar-collection-main"
                          }
                          onClick={() => {
                            setActiveCollectionId(collection.id);
                            setShowCollectionOnly(true);
                            setCollectionEditorOpen(false);
                          }}
                          type="button"
                        >
                          <span>{formatCollectionTitle(collection.name)}</span>
                          <small>({collection.itemIds.length})</small>
                        </button>
                        <button
                          aria-label={`Delete ${formatCollectionTitle(collection.name)} collection`}
                          className="gif-sidebar-collection-delete"
                          onClick={() => deleteCollection(collection.id)}
                          title="Delete collection"
                          type="button"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="gif-collection-empty" id="gif-sidebar-collections">No collections yet.</p>
                )
              ) : null}
            </div>
            {collectionSyncError ? <p className="gif-collection-empty">{collectionSyncError}</p> : null}
          </aside>

          <section className="gif-results" aria-label="GIF catalog">
            <div className="gif-results__header">
              <div>
                <span className="gif-kicker">{loading ? "Loading" : "Catalog"}</span>
                <h1>
                  {showCollectionOnly && activeCollection
                    ? formatCollectionTitle(activeCollection.name)
                    : activeCategory
                      ? activeCategory
                    : (
                      <>
                        Popular <span>/ Wired</span>
                      </>
                    )}
                </h1>
              </div>
              <div className="gif-results__actions">
                {showCollectionOnly && activeCollection && collectionItems.length > 0 ? (
                  <button
                    className="gif-bulk-download"
                    onClick={() => setBulkExportOpen(true)}
                    type="button"
                  >
                    <Download size={16} />
                    <span>Bulk export</span>
                  </button>
                ) : null}
                <span className="gif-pill">
                  {showCollectionOnly
                    ? `${formatNumber(visibleItems.length)} visible`
                    : activeCategory
                      ? `${formatNumber(items.length)} / ${formatNumber(activeCategoryCount)} in category`
                    : `${formatNumber(items.length)} / ${formatNumber(total)} loaded`}
                </span>
              </div>
            </div>

            {error ? <p className="gif-error">{error}</p> : null}

            {visibleItems.length > 0 ? (
              <>
                <div className={`gif-grid gif-grid--${density}`}>
                  {visibleItems.map((item) => {
                    const isInCollection = collectionIdSet.has(item.id);
                    const itemCollectionCount = collections.filter((collection) =>
                      collection.itemIds.includes(item.id),
                    ).length;

                    return (
                      <article
                        className={[
                          "gif-card",
                          item.id === selectedItem?.id ? "is-selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={item.id}
                        onBlur={(event) => {
                          const nextFocus = event.relatedTarget;
                          if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
                          setAnimatedCardId((current) => (current === item.id ? "" : current));
                        }}
                        onFocus={() => setAnimatedCardId(item.id)}
                        onPointerEnter={() => setAnimatedCardId(item.id)}
                        onPointerLeave={() => {
                          setAnimatedCardId((current) => (current === item.id ? "" : current));
                        }}
                      >
                        <button
                          className="gif-card__select"
                          onClick={() => {
                            setSelectedId(item.id);
                            if (showCollectionOnly) setCollectionEditorOpen(true);
                          }}
                          type="button"
                        >
                          <span className="gif-card__media">
                            {itemCollectionCount > 0 ? (
                              <span className="gif-card__badge">{itemCollectionCount}</span>
                            ) : null}
                            <HoverAnimatedGif isAnimating={animatedCardId === item.id} item={item} />
                          </span>
                        </button>
                        <span className="gif-card__body">
                          <strong>{formatGifTitle(item.title)}</strong>
                        </span>
                        <div className="gif-card__actions">
                          <button
                            aria-label={`Add ${item.title} to collection`}
                            aria-pressed={isInCollection}
                            className="gif-card__add"
                            onClick={() => openCollectionDialog(item)}
                            title="Add to collection"
                            type="button"
                          >
                            <Plus size={19} />
                          </button>
                          <button
                            aria-label={`Open ${item.title} in editor`}
                            className="gif-card__open"
                            onClick={() => {
                              setSelectedId(item.id);
                              if (showCollectionOnly) setCollectionEditorOpen(true);
                            }}
                            title="Open"
                            type="button"
                          >
                            <ExternalLink size={17} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {!showCollectionOnly && total > catalogPageSize ? (
                  <div className="gif-load-more" ref={loadMoreRef}>
                    <span>
                      {formatNumber(items.length)} of {formatNumber(total)} loaded
                    </span>
                    {canLoadMore ? (
                      <button
                        disabled={loading || loadingMore}
                        onClick={loadMoreCatalog}
                        type="button"
                      >
                        {loadingMore ? <RefreshCw className="is-spinning" size={16} /> : <Plus size={16} />}
                        <span>{loadingMore ? "Loading" : "Load more"}</span>
                      </button>
                    ) : (
                      <small>All loaded</small>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="gif-empty">
                <Search size={22} />
                <strong>{showCollectionOnly ? "Collection is empty" : "No matches"}</strong>
              </div>
            )}
          </section>

          <aside
            className={selectedItem ? "gif-inspector" : "gif-inspector gif-inspector--empty"}
            aria-label="Selected GIF"
            id="variants"
          >
            {selectedItem ? (
              <>
                <div className="gif-inspector-photo">
                  <div className="gif-inspector-photo__header">
                    <h2>Photo</h2>
                    <span className="gif-inspector-photo__actions" aria-hidden="true">
                      <Plus size={24} strokeWidth={2} />
                      <MoreVertical size={21} strokeWidth={2} />
                    </span>
                  </div>

                  <div
                    className={
                      photoBackdropEnabled
                        ? "gif-inspector-photo__body is-backdrop-enabled"
                        : "gif-inspector-photo__body"
                    }
                  >
                    <button
                      aria-label={photoBackdropEnabled ? "Disable photo background" : "Enable photo background"}
                      aria-pressed={photoBackdropEnabled}
                      className={
                        photoBackdropEnabled
                          ? "gif-inspector-photo__toggle is-active"
                          : "gif-inspector-photo__toggle"
                      }
                      onClick={() => setPhotoBackdropEnabled((value) => !value)}
                      title={photoBackdropEnabled ? "Disable photo background" : "Enable photo background"}
                      type="button"
                    >
                      <span />
                    </button>

                    <div className="gif-preview">
                      {previewLoading ? <span className="gif-preview__badge">Preparing</span> : null}
                      <GifCanvasPreview
                        alt={selectedItem.title}
                        colorSlots={colorSlots}
                        colorTargets={colorTargets}
                        fallbackSrc={previewImageSrc}
                        onProgressChange={setPhotoPreviewProgress}
                        playing={photoPreviewPlaying}
                        preview={previewFrames}
                        seekProgress={photoPreviewSeek.progress}
                        seekVersion={photoPreviewSeek.version}
                        stroke={stroke}
                      />
                    </div>

                    <div className="gif-photo-player">
                      <button
                        aria-label={photoPreviewPlaying ? "Pause preview" : "Play preview"}
                        className={
                          photoPreviewPlaying
                            ? "gif-photo-player__button is-playing"
                            : "gif-photo-player__button"
                        }
                        onClick={() => setPhotoPreviewPlaying((value) => !value)}
                        title={photoPreviewPlaying ? "Pause preview" : "Play preview"}
                        type="button"
                      >
                        {photoPreviewPlaying ? (
                          <>
                            <span />
                            <span />
                          </>
                        ) : (
                          <span className="gif-photo-player__play" />
                        )}
                      </button>
                      <span
                        aria-disabled={!previewFrames}
                        aria-label="Seek preview"
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={Math.round(photoPreviewProgress * 100)}
                        className="gif-photo-player__track"
                        onKeyDown={handlePhotoSeekKeyDown}
                        onLostPointerCapture={stopPhotoSeekPointer}
                        onPointerCancel={stopPhotoSeekPointer}
                        onPointerDown={handlePhotoSeekPointerDown}
                        onPointerMove={handlePhotoSeekPointerMove}
                        onPointerUp={stopPhotoSeekPointer}
                        role="slider"
                        tabIndex={previewFrames ? 0 : -1}
                      >
                        <span className="gif-photo-player__fill" style={photoPreviewProgressStyle} />
                        <span className="gif-photo-player__knob" style={photoPreviewProgressStyle} />
                      </span>
                    </div>
                  </div>
                </div>

                <div className="gif-inspector-editor">
                  <div className="gif-panel-header gif-panel-header--split">
                    <h2>Editor</h2>
                    <button
                      aria-label="Reset editor"
                      className="gif-icon-button"
                      disabled={!canEditSelected || analysisLoading || !hasEditorChanges}
                      onClick={resetEditorColors}
                      title="Reset editor"
                      type="button"
                    >
                      <RefreshCw className={analysisLoading ? "is-spinning" : ""} size={17} />
                    </button>
                  </div>

                  <div className="gif-editor-section" ref={colorPickerRef}>
                    <span className="gif-editor-label">COLORS</span>
                    <div className="gif-color-slots" aria-label="Detected colors">
                      {analysisLoading ? (
                        <span className="gif-editor-note">Detecting</span>
                      ) : colorSlots.length > 0 ? (
                        colorSlots.map((slot) => {
                          const sourceHex = normalizeHex(slot.hex);

                          return (
                            <button
                              aria-label={`${slot.hex} color slot`}
                              className={sourceHex === activeColor ? "gif-color-slot is-active" : "gif-color-slot"}
                              key={slot.id}
                              onClick={() => {
                                setActiveColor(sourceHex);
                                setColorPickerOpen(true);
                              }}
                              style={
                                {
                                  "--slot-source": sourceHex,
                                  "--slot-contrast": getContrastColor(sourceHex),
                                } as CSSProperties
                              }
                              title={slot.hex}
                              type="button"
                            >
                              {slot.isStroke ? <span /> : null}
                            </button>
                          );
                        })
                      ) : (
                        <span className="gif-editor-note">No colors</span>
                      )}
                    </div>

                    {activeSlot && colorPickerOpen ? (
                      <div className="gif-color-popover" role="dialog" aria-label="Color palette">
                        <div className="gif-color-popover__header">
                          <label
                            className="gif-color-popover__swatch"
                            style={{ "--picker-color": normalizeHex(activeTarget) } as CSSProperties}
                            title="Custom color"
                          >
                            <input
                              aria-label="Custom replacement color"
                              onChange={(event) => updateActiveColor(event.target.value)}
                              type="color"
                              value={normalizeHex(activeTarget)}
                            />
                          </label>
                          <label className="gif-color-popover__hex">
                            <span>#</span>
                            <input
                              aria-label="Hex replacement color"
                              defaultValue={normalizeHex(activeTarget).replace("#", "")}
                              key={`${activeSlot.id}-${normalizeHex(activeTarget)}`}
                              maxLength={6}
                              onBlur={(event) => updateActiveColor(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  updateActiveColor(event.currentTarget.value);
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </label>
                        </div>
                        <div className="gif-color-popover__grid" aria-label="Replacement colors">
                          {colorPickerPalette.map((hex) => (
                            <button
                              aria-label={hex}
                              className={normalizeHex(activeTarget) === hex ? "is-active" : ""}
                              key={hex}
                              onClick={() => updateActiveColor(hex)}
                              style={{ "--picker-color": hex } as CSSProperties}
                              title={hex}
                              type="button"
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="gif-editor-section">
                    <span className="gif-editor-label">STROKE</span>
                    <div className="gif-stroke-switch" aria-label="Stroke weight">
                      {strokeOptions.map((item) => (
                        <button
                          className={stroke === item ? "is-active" : ""}
                          key={item}
                          onClick={() => setStroke(item)}
                          type="button"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="gif-actions">
                    <button
                      className="gif-action-primary"
                      disabled={!canExportVariant || exporting}
                      onClick={() => {
                        if (previewFrames) {
                          setExportDelay(getPreviewDuration(previewFrames));
                        }
                        setExportOpen(true);
                      }}
                      title={
                        selectedItem.origin === "archive"
                          ? "Open GIF export settings"
                          : "Add GIF files to the archive to export variants"
                      }
                      type="button"
                    >
                      <WandSparkles size={18} />
                      <span>Export GIF</span>
                    </button>
                    <a className="gif-action-secondary" download={selectedItem.fileName} href={selectedItem.src}>
                      <Download size={18} />
                      <span>Original GIF</span>
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div className="gif-inspector-empty">
                <span className="gif-inspector-empty__icon">
                  <Sparkles size={70} strokeWidth={1.6} />
                </span>
                <span>Select to edit</span>
              </div>
            )}
          </aside>
        </div>
      </main>

      {collectionDialogItem ? (
        <div className="gif-collection-dialog-overlay" role="presentation">
          <section
            aria-label={collectionDialogMode === "add" ? "Add to collection" : "Create new collection"}
            aria-modal="true"
            className="gif-collection-dialog"
            role="dialog"
          >
            <header className="gif-collection-dialog__header">
              <h2>{collectionDialogMode === "add" ? "Add to collection" : "Create new collection"}</h2>
              <button
                aria-label="Close collection dialog"
                onClick={closeCollectionDialog}
                title="Close"
                type="button"
              >
                <X size={22} />
              </button>
            </header>

            {collectionDialogMode === "add" ? (
              <>
                {collections.length > 0 ? (
                  <div className="gif-collection-dialog__groups">
                    {activeCollection ? (
                      <section>
                        <span className="gif-collection-dialog__label">RECENTLY USED</span>
                        <button
                          className={activeCollection.itemIds.includes(collectionDialogItem.id) ? "is-added" : ""}
                          onClick={() => addDialogItemToCollection(activeCollection.id)}
                          type="button"
                        >
                          {formatCollectionTitle(activeCollection.name)}
                        </button>
                      </section>
                    ) : null}
                    <section>
                      <span className="gif-collection-dialog__label">PERSONAL</span>
                      {collections.map((collection) => (
                        <button
                          className={collection.itemIds.includes(collectionDialogItem.id) ? "is-added" : ""}
                          key={collection.id}
                          onClick={() => addDialogItemToCollection(collection.id)}
                          type="button"
                        >
                          {formatCollectionTitle(collection.name)}
                        </button>
                      ))}
                    </section>
                  </div>
                ) : (
                  <p className="gif-collection-dialog__empty">Empty list.</p>
                )}

                <button
                  className="gif-collection-dialog__primary"
                  onClick={() => {
                    setCollectionDialogMode("create");
                    setCollectionDraftName("");
                  }}
                  type="button"
                >
                  New collection
                </button>
              </>
            ) : (
              <form
                className="gif-collection-dialog__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  createCollectionFromDialog();
                }}
              >
                <label>
                  <span>Name</span>
                  <input
                    autoFocus
                    onChange={(event) => setCollectionDraftName(event.target.value)}
                    value={collectionDraftName}
                  />
                </label>
                <div className="gif-collection-dialog__actions">
                  <button
                    className="gif-collection-dialog__secondary"
                    onClick={() => setCollectionDialogMode("add")}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="gif-collection-dialog__primary"
                    disabled={!collectionDraftName.trim()}
                    type="submit"
                  >
                    OK
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}

      {bulkExportOpen && activeCollection ? (
        <div className="gif-export-overlay" role="presentation">
          <section
            aria-label="Bulk export as GIFs"
            aria-modal="true"
            className="gif-export-modal gif-export-modal--bulk"
            role="dialog"
          >
            <header className="gif-export-modal__header">
              <h2>Bulk export as GIFs</h2>
              <button
                aria-label="Close bulk export settings"
                className="gif-icon-button"
                disabled={bulkExporting}
                onClick={() => setBulkExportOpen(false)}
                title="Close"
                type="button"
              >
                <X size={19} />
              </button>
            </header>

            <div className="gif-export-modal__body gif-export-modal__body--bulk">
              <div className="gif-bulk-export-summary">
                <Download size={32} />
                <strong>{formatCollectionTitle(activeCollection.name)}</strong>
                <span>{bulkExportTotal} GIFs</span>
                {bulkExporting ? (
                  <div
                    aria-label={`Bulk export ${bulkExportPercent}% complete`}
                    className="gif-bulk-export-progress"
                    role="progressbar"
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={bulkExportPercent}
                  >
                    <div className="gif-bulk-export-progress__meta">
                      <span>{bulkExportPercent}%</span>
                      <small>
                        {bulkExportIndex} / {bulkExportTotal}
                      </small>
                    </div>
                    <span className="gif-bulk-export-progress__track">
                      <span
                        className="gif-bulk-export-progress__fill"
                        style={{ "--bulk-export-progress": `${bulkExportPercent}%` } as CSSProperties}
                      />
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="gif-export-controls">
                <section className="gif-export-control">
                  <span className="gif-editor-label">BACKGROUND COLOR</span>
                  <div className="gif-export-segment">
                    <button
                      className={exportBackgroundMode === "solid" ? "is-active" : ""}
                      onClick={() => setExportBackgroundMode("solid")}
                      type="button"
                    >
                      <span
                        className="gif-export-solid-dot"
                        style={{ "--export-background": exportBackgroundColor } as CSSProperties}
                      />
                      Solid
                    </button>
                    <button
                      className={exportBackgroundMode === "transparent" ? "is-active" : ""}
                      onClick={() => setExportBackgroundMode("transparent")}
                      type="button"
                    >
                      <span className="gif-export-transparent-dot" />
                      Transparent
                    </button>
                    <label className="gif-export-color-input" title="Solid background color">
                      <input
                        aria-label="Solid background color"
                        disabled={exportBackgroundMode !== "solid"}
                        onChange={(event) => setExportBackgroundColor(event.target.value)}
                        type="color"
                        value={exportBackgroundColor}
                      />
                    </label>
                  </div>
                </section>

                <NumberStepper
                  label="DELAY"
                  max={12000}
                  min={120}
                  onChange={setExportDelay}
                  step={250}
                  unit="ms"
                  value={exportDelay}
                />

                <label className="gif-export-loop">
                  <input
                    checked={exportLoop}
                    onChange={(event) => setExportLoop(event.target.checked)}
                    type="checkbox"
                  />
                  <span />
                  Infinite loop
                </label>
              </div>
            </div>

            <footer className="gif-export-modal__footer">
              <span className="gif-export-help">Applies settings to every GIF</span>
              <button
                className="gif-export-download"
                disabled={bulkExporting || bulkExportTotal === 0}
                onClick={downloadBulkExportGifs}
                type="button"
              >
                {bulkExporting ? <RefreshCw className="is-spinning" size={18} /> : <Download size={18} />}
                <span>{bulkExporting ? `Exporting ${bulkExportPercent}%` : "Export all"}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {exportOpen && selectedItem ? (
        <div className="gif-export-overlay" role="presentation">
          <section
            aria-label="Export as a GIF"
            aria-modal="true"
            className="gif-export-modal"
            role="dialog"
          >
            <header className="gif-export-modal__header">
              <h2>Export as a GIF</h2>
              <button
                aria-label="Close export settings"
                className="gif-icon-button"
                onClick={() => setExportOpen(false)}
                title="Close"
                type="button"
              >
                <X size={19} />
              </button>
            </header>

            <div className="gif-export-modal__body">
              <div
                className={
                  exportBackgroundMode === "transparent"
                    ? "gif-export-preview is-transparent"
                    : "gif-export-preview"
                }
                style={{ "--export-background": exportBackgroundColor } as CSSProperties}
              >
                <GifCanvasPreview
                  alt={`${selectedItem.title} export preview`}
                  colorSlots={colorSlots}
                  colorTargets={colorTargets}
                  fallbackSrc={previewImageSrc}
                  preview={previewFrames}
                  stroke={stroke}
                />
              </div>

              <div className="gif-export-controls">
                <section className="gif-export-control">
                  <span className="gif-editor-label">BACKGROUND COLOR</span>
                  <div className="gif-export-segment">
                    <button
                      className={exportBackgroundMode === "solid" ? "is-active" : ""}
                      onClick={() => setExportBackgroundMode("solid")}
                      type="button"
                    >
                      <span
                        className="gif-export-solid-dot"
                        style={{ "--export-background": exportBackgroundColor } as CSSProperties}
                      />
                      Solid
                    </button>
                    <button
                      className={exportBackgroundMode === "transparent" ? "is-active" : ""}
                      onClick={() => setExportBackgroundMode("transparent")}
                      type="button"
                    >
                      <span className="gif-export-transparent-dot" />
                      Transparent
                    </button>
                    <label className="gif-export-color-input" title="Solid background color">
                      <input
                        aria-label="Solid background color"
                        disabled={exportBackgroundMode !== "solid"}
                        onChange={(event) => setExportBackgroundColor(event.target.value)}
                        type="color"
                        value={exportBackgroundColor}
                      />
                    </label>
                  </div>
                </section>

                <NumberStepper
                  label="DELAY"
                  max={12000}
                  min={120}
                  onChange={setExportDelay}
                  step={250}
                  unit="ms"
                  value={exportDelay}
                />

                <label className="gif-export-loop">
                  <input
                    checked={exportLoop}
                    onChange={(event) => setExportLoop(event.target.checked)}
                    type="checkbox"
                  />
                  <span />
                  Infinite loop
                </label>
              </div>
            </div>

            <footer className="gif-export-modal__footer">
              <a className="gif-export-help" href="/api/gifs?limit=1">
                <HelpCircle size={17} />
                How to use GIF
              </a>
              <button
                className="gif-export-download"
                disabled={!canExportVariant || exporting}
                onClick={downloadVariantGif}
                type="button"
              >
                {exporting ? <RefreshCw className="is-spinning" size={18} /> : <Download size={18} />}
                <span>{exporting ? "Exporting" : "Download"}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

type GifCanvasPreviewProps = {
  alt: string;
  colorSlots: GifColorSlot[];
  colorTargets: Record<string, string>;
  fallbackSrc: string;
  onProgressChange?: (progress: number) => void;
  playing?: boolean;
  preview: GifPreviewFrameData | null;
  seekProgress?: number;
  seekVersion?: number;
  stroke: StrokeWeight;
};

type HoverAnimatedGifProps = {
  isAnimating: boolean;
  item: GifItem;
};

type NumberStepperProps = {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  unit: string;
  value: number;
};

function HoverAnimatedGif({ isAnimating, item }: HoverAnimatedGifProps) {
  const [loadedImageSrc, setLoadedImageSrc] = useState("");
  const [posterFailed, setPosterFailed] = useState(false);
  const [posterTimedOut, setPosterTimedOut] = useState(false);

  const posterVersion = encodeURIComponent(`${item.updatedAt}:${item.bytes}`);
  const posterSrc = item.origin === "archive" ? `/api/gifs/poster/${item.id}?v=${posterVersion}` : item.src;
  const usePoster = item.origin === "archive" && !posterFailed && !posterTimedOut && !isAnimating;
  const imageSrc = usePoster ? posterSrc : item.src;
  const imageLoaded = loadedImageSrc === imageSrc;
  const rememberLoadedImage = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) {
      setLoadedImageSrc(imageSrc);
    }
  }, [imageSrc]);

  useEffect(() => {
    if (!usePoster) return undefined;

    const timer = window.setTimeout(() => {
      setPosterTimedOut(true);
    }, 900);

    return () => {
      window.clearTimeout(timer);
    };
  }, [usePoster, posterSrc]);

  return (
    <>
      <img
        alt={item.title}
        className={imageLoaded ? "is-loaded" : ""}
        decoding="async"
        loading="lazy"
        onError={() => {
          if (usePoster) setPosterFailed(true);
          setLoadedImageSrc("");
        }}
        onLoad={() => setLoadedImageSrc(imageSrc)}
        ref={rememberLoadedImage}
        src={imageSrc}
      />
      {!imageLoaded ? <span className="gif-card__image-loader" aria-hidden="true" /> : null}
    </>
  );
}

function NumberStepper({
  label,
  max,
  min,
  onChange,
  step,
  unit,
  value,
}: NumberStepperProps) {
  function updateValue(nextValue: number) {
    onChange(Math.max(min, Math.min(max, Math.round(nextValue))));
  }

  return (
    <section className="gif-export-control">
      <span className="gif-editor-label">{label}</span>
      <div className="gif-export-stepper">
        <button
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => updateValue(value - step)}
          type="button"
        >
          <Minus size={16} />
        </button>
        <input
          aria-label={label}
          max={max}
          min={min}
          onChange={(event) => updateValue(Number(event.target.value))}
          step={step}
          type="number"
          value={value}
        />
        <span>{unit}</span>
        <button
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => updateValue(value + step)}
          type="button"
        >
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}

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

type PreviewColorSlot = GifColorSlot & {
  rgb: Rgb;
};

const previewColorDistanceLimit = 128;

function GifCanvasPreview({
  alt,
  colorSlots,
  colorTargets,
  fallbackSrc,
  onProgressChange,
  playing = true,
  preview,
  seekProgress = 0,
  seekVersion = 0,
  stroke,
}: GifCanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onProgressChangeRef = useRef(onProgressChange);
  const playingRef = useRef(playing);
  const seekRef = useRef({ progress: seekProgress, version: seekVersion });
  const rawFrames = useMemo(
    () => (preview ? decodePreviewData(preview.data) : null),
    [preview],
  );
  const renderedFrames = useMemo(() => {
    if (!preview || !rawFrames) return null;
    return renderPreviewFrames(rawFrames, preview, colorSlots, colorTargets, stroke);
  }, [colorSlots, colorTargets, preview, rawFrames, stroke]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);

  useEffect(() => {
    seekRef.current = { progress: seekProgress, version: seekVersion };
  }, [seekProgress, seekVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview || !renderedFrames) return undefined;

    const activePreview = preview;
    const activeFrames = renderedFrames;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const frameLength = activePreview.width * activePreview.pageHeight * 4;
    const frameDelays = Array.from({ length: activePreview.pages }, (_, index) =>
      Math.max(20, activePreview.delay[index] ?? 80),
    );
    const totalDuration = Math.max(1, frameDelays.reduce((total, delay) => total + delay, 0));
    let elapsedTime = 0;
    let frameIndex = 0;
    let previousTime = performance.now();
    let animationId = 0;
    let lastReportedProgress = -1;
    let handledSeekVersion = seekRef.current.version;

    canvas.width = activePreview.width;
    canvas.height = activePreview.pageHeight;

    function drawFrame(index: number) {
      const offset = index * frameLength;
      const frame = activeFrames.slice(offset, offset + frameLength);
      context?.putImageData(new ImageData(frame, activePreview.width, activePreview.pageHeight), 0, 0);
    }

    function getFrameIndex(time: number) {
      let frameStart = 0;

      for (let index = 0; index < frameDelays.length; index += 1) {
        const frameEnd = frameStart + frameDelays[index];
        if (time < frameEnd) return index;
        frameStart = frameEnd;
      }

      return Math.max(0, frameDelays.length - 1);
    }

    function reportProgress(progress: number) {
      const nextProgress = Math.max(0, Math.min(1, progress));

      if (Math.abs(nextProgress - lastReportedProgress) < 0.004 && nextProgress !== 0) {
        return;
      }

      lastReportedProgress = nextProgress;
      onProgressChangeRef.current?.(nextProgress);
    }

    function seekToProgress(progress: number) {
      const boundedProgress = Math.max(0, Math.min(1, progress));
      elapsedTime = Math.min(totalDuration - 0.001, boundedProgress * totalDuration);
      frameIndex = getFrameIndex(elapsedTime);
      drawFrame(frameIndex);
      reportProgress(boundedProgress);
    }

    function tick(now: number) {
      if (seekRef.current.version !== handledSeekVersion) {
        handledSeekVersion = seekRef.current.version;
        seekToProgress(seekRef.current.progress);
        previousTime = now;
      }

      if (playingRef.current) {
        const delta = Math.max(0, now - previousTime);
        elapsedTime = (elapsedTime + delta) % totalDuration;

        const nextFrameIndex = getFrameIndex(elapsedTime);
        if (nextFrameIndex !== frameIndex) {
          frameIndex = nextFrameIndex;
          drawFrame(frameIndex);
        }

        reportProgress(elapsedTime / totalDuration);
      }

      previousTime = now;
      animationId = window.requestAnimationFrame(tick);
    }

    drawFrame(0);
    reportProgress(0);
    animationId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationId);
    };
  }, [preview, renderedFrames]);

  if (!preview || !renderedFrames) {
    return <img alt={alt} src={fallbackSrc} />;
  }

  return <canvas aria-label={alt} ref={canvasRef} role="img" />;
}

function decodePreviewData(value: string): Uint8ClampedArray {
  const binary = window.atob(value);
  const data = new Uint8ClampedArray(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }

  return data;
}

function getPreviewDuration(preview: GifPreviewFrameData): number {
  const duration = preview.delay.reduce((total, delay) => total + delay, 0);
  return Math.max(120, Math.min(12000, Math.round(duration || 2000)));
}

function renderPreviewFrames(
  rawFrames: Uint8ClampedArray,
  preview: GifPreviewFrameData,
  colorSlots: GifColorSlot[],
  colorTargets: Record<string, string>,
  stroke: StrokeWeight,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(rawFrames);
  const slots = colorSlots.flatMap((slot) => {
    const rgb = hexToRgb(slot.hex);
    return rgb ? [{ ...slot, rgb }] : [];
  });

  if (slots.length === 0) return output;

  const replacements = createPreviewReplacementMap(colorSlots, colorTargets);
  applyPreviewColorReplacements(output, rawFrames, slots, replacements);

  const strokeSlot = slots.find((slot) => slot.isStroke) ?? slots[0];
  const strokeMask = createPreviewStrokeMask(rawFrames, slots, strokeSlot);
  applyPreviewStrokeTone(output, strokeMask, preview, stroke);

  return output;
}

function createPreviewReplacementMap(
  colorSlots: GifColorSlot[],
  colorTargets: Record<string, string>,
): Map<string, Rgb> {
  const replacements = new Map<string, Rgb>();

  for (const slot of colorSlots) {
    const source = normalizeHex(slot.hex);
    const target = normalizeHex(colorTargets[source] ?? source);
    const rgb = hexToRgb(target);

    if (source !== target && rgb) {
      replacements.set(source, rgb);
    }
  }

  return replacements;
}

function applyPreviewColorReplacements(
  output: Uint8ClampedArray,
  rawFrames: Uint8ClampedArray,
  slots: PreviewColorSlot[],
  replacements: Map<string, Rgb>,
): void {
  if (replacements.size === 0) return;

  for (let index = 0; index < rawFrames.length; index += 4) {
    const alpha = rawFrames[index + 3];
    if (alpha < 8) continue;

    const pixel = {
      r: rawFrames[index],
      g: rawFrames[index + 1],
      b: rawFrames[index + 2],
    };
    const nearest = findNearestPreviewSlot(pixel, slots);
    if (!nearest || nearest.distance > previewColorDistanceLimit) continue;

    const target = replacements.get(normalizeHex(nearest.slot.hex));
    if (!target) continue;

    const shifted = shiftPreviewPixelToTarget(pixel, nearest.slot.rgb, target);
    output[index] = shifted.r;
    output[index + 1] = shifted.g;
    output[index + 2] = shifted.b;
  }
}

function createPreviewStrokeMask(
  rawFrames: Uint8ClampedArray,
  slots: PreviewColorSlot[],
  strokeSlot: PreviewColorSlot,
): Uint8Array {
  const mask = new Uint8Array(rawFrames.length / 4);

  for (let index = 0, pixelIndex = 0; index < rawFrames.length; index += 4, pixelIndex += 1) {
    const alpha = rawFrames[index + 3];
    if (alpha < 8) continue;

    const pixel = {
      r: rawFrames[index],
      g: rawFrames[index + 1],
      b: rawFrames[index + 2],
    };
    const luminance = getLuminance(pixel);
    const nearest = findNearestPreviewSlot(pixel, slots);
    const strokeDistance = colorDistance(pixel, strokeSlot.rgb);
    const isNearestStroke =
      nearest?.slot.id === strokeSlot.id && nearest.distance <= 74 && strokeDistance <= 92;
    const isCloseStrokeShade =
      strokeDistance <= 58 && luminance < 130;

    if (isNearestStroke || isCloseStrokeShade) {
      mask[pixelIndex] = 1;
    }
  }

  return mask;
}

function applyPreviewStrokeTone(
  output: Uint8ClampedArray,
  strokeMask: Uint8Array,
  preview: GifPreviewFrameData,
  stroke: StrokeWeight,
): void {
  for (let pixelIndex = 0; pixelIndex < strokeMask.length; pixelIndex += 1) {
    if (!strokeMask[pixelIndex]) continue;

    const dataIndex = pixelIndex * 4;
    const toned = tonePreviewStrokePixel(
      {
        r: output[dataIndex],
        g: output[dataIndex + 1],
        b: output[dataIndex + 2],
      },
      stroke,
    );

    output[dataIndex] = toned.r;
    output[dataIndex + 1] = toned.g;
    output[dataIndex + 2] = toned.b;
  }

  if (stroke === "bold") {
    expandPreviewBoldStroke(output, strokeMask, preview);
  }
}

function tonePreviewStrokePixel(pixel: Rgb, stroke: StrokeWeight): Rgb {
  const hsl = rgbToHsl(pixel);
  const luminance = getLuminance(pixel);
  const isNeutralDark = hsl.s < 0.22 && luminance < 132;
  const isNeutralStroke = hsl.s < 0.3 && luminance < 210;

  if (stroke === "light") {
    if (isNeutralDark) {
      return mixPreviewRgb(pixel, { r: 120, g: 132, b: 160 }, 0.95);
    }

    return hslToRgb({
      h: hsl.h,
      s: clamp(hsl.s * 0.9, 0, 1),
      l: clamp(hsl.l + 0.25, 0.04, 0.96),
    });
  }

  if (stroke === "regular") {
    if (isNeutralStroke) {
      return mixPreviewRgb(pixel, { r: 0, g: 2, b: 18 }, isNeutralDark ? 0.38 : 0.28);
    }

    return hslToRgb({
      h: hsl.h,
      s: clamp(hsl.s * 1.04, 0, 1),
      l: clamp(hsl.l - 0.045, 0.02, 0.94),
    });
  }

  if (isNeutralStroke) {
    return mixPreviewRgb(pixel, { r: 0, g: 0, b: 0 }, isNeutralDark ? 1 : 0.76);
  }

  return hslToRgb({
    h: hsl.h,
    s: clamp(hsl.s * 1.16, 0, 1),
    l: clamp(hsl.l - 0.28, 0.02, 0.94),
  });
}

function expandPreviewBoldStroke(
  output: Uint8ClampedArray,
  strokeMask: Uint8Array,
  preview: GifPreviewFrameData,
): void {
  const source = new Uint8ClampedArray(output);

  for (let page = 0; page < preview.pages; page += 1) {
    const pageOffset = page * preview.width * preview.pageHeight;

    for (let y = 0; y < preview.pageHeight; y += 1) {
      for (let x = 0; x < preview.width; x += 1) {
        const pixelIndex = pageOffset + y * preview.width + x;
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
            if (nx < 0 || nx >= preview.width || ny < 0 || ny >= preview.pageHeight) continue;

            const targetPixelIndex = pageOffset + ny * preview.width + nx;
            if (strokeMask[targetPixelIndex]) continue;

            const targetIndex = targetPixelIndex * 4;
            const targetAlpha = source[targetIndex + 3];
            const targetPixel = {
              r: source[targetIndex],
              g: source[targetIndex + 1],
              b: source[targetIndex + 2],
            };

            if (!canReceivePreviewBoldStroke(targetPixel, targetAlpha)) continue;

            const amount = distance <= 1 ? 0.88 : 0.54;
            const blended = mixPreviewRgb(targetPixel, strokeColor, amount);
            output[targetIndex] = blended.r;
            output[targetIndex + 1] = blended.g;
            output[targetIndex + 2] = blended.b;
          }
        }
      }
    }
  }
}

function canReceivePreviewBoldStroke(pixel: Rgb, alpha: number): boolean {
  if (alpha < 64) return false;

  const hsl = rgbToHsl(pixel);
  const luminance = getLuminance(pixel);
  return (luminance > 242 && hsl.s < 0.16) || alpha >= 64;
}

function mixPreviewRgb(source: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: Math.round(source.r * (1 - amount) + target.r * amount),
    g: Math.round(source.g * (1 - amount) + target.g * amount),
    b: Math.round(source.b * (1 - amount) + target.b * amount),
  };
}

function findNearestPreviewSlot(pixel: Rgb, slots: PreviewColorSlot[]) {
  let nearest: { distance: number; slot: PreviewColorSlot } | null = null;

  for (const slot of slots) {
    const distance = colorDistance(pixel, slot.rgb);
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, slot };
    }
  }

  return nearest;
}

function shiftPreviewPixelToTarget(pixel: Rgb, source: Rgb, target: Rgb): Rgb {
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

function createGifProcessingCacheKey(item: GifItem): string {
  return `${item.id}:${item.updatedAt}:${item.bytes}`;
}

function createGifProcessingUrl(kind: "analyze" | "preview", item: GifItem): string {
  const version = encodeURIComponent(`${item.updatedAt}:${item.bytes}`);
  return `/api/gifs/${kind}/${item.id}?v=${version}`;
}

function rememberClientCache<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  limit: number,
): void {
  cache.delete(key);
  cache.set(key, value);

  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (!oldest) return;
    cache.delete(oldest);
  }
}

function mergeCatalogItems(currentItems: GifItem[], nextItems: GifItem[]): GifItem[] {
  const seen = new Set(currentItems.map((item) => item.id));
  const merged = [...currentItems];

  for (const item of nextItems) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return merged;
}

function readCatalogCategories(data: GifCatalogResponse, fallbackItems: GifItem[]): GifCategorySummary[] {
  return Array.isArray(data.categories) && data.categories.length > 0
    ? data.categories
    : createCategorySummaries(fallbackItems);
}

function createCatalogPageCacheKey(category: string, query: string): string {
  return `${category.trim().toLowerCase()}\u0000${query.trim().toLowerCase()}`;
}

function rememberCatalogPage(
  cache: Map<string, CatalogPageCacheEntry>,
  key: string,
  entry: CatalogPageCacheEntry,
): void {
  const maxCachedCatalogPages = 24;

  cache.delete(key);
  cache.set(key, entry);

  while (cache.size > maxCachedCatalogPages) {
    const oldest = cache.keys().next().value;
    if (!oldest) return;
    cache.delete(oldest);
  }
}

function createCategorySummaries(items: GifItem[]): GifCategorySummary[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    const category = item.category.trim() || "General";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return Array.from(counts, ([name, count]) => ({ count, name }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function createEditorPayload(
  colorSlots: GifColorSlot[],
  colorTargets: Record<string, string>,
  stroke: StrokeWeight,
): GifEditorRequest {
  const colors: GifColorReplacement[] = colorSlots.flatMap((slot) => {
    const source = normalizeHex(slot.hex);
    const target = normalizeHex(colorTargets[source] ?? source);

    if (!isHexColor(target) || source === target) return [];
    return [{ source, target }];
  });

  return { colors, stroke };
}

function createCollectionStoreSnapshot(
  collections: GifCollection[],
  itemsById: Record<string, GifItem>,
  activeCollectionId: string,
): GifCollectionStore {
  const usedIds = new Set(collections.flatMap((collection) => collection.itemIds));
  const usedItemsById: Record<string, GifItem> = {};

  for (const id of usedIds) {
    const item = itemsById[id];
    if (item) usedItemsById[id] = item;
  }

  return {
    activeCollectionId: collections.some((collection) => collection.id === activeCollectionId)
      ? activeCollectionId
      : collections[0]?.id ?? "",
    collections,
    itemsById: usedItemsById,
    updatedAt: new Date().toISOString(),
  };
}

function createColorTargetMap(colorSlots: GifColorSlot[]): Record<string, string> {
  return Object.fromEntries(colorSlots.map((slot) => [normalizeHex(slot.hex), normalizeHex(slot.hex)]));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCollectionTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Untitled";
  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`;
}

function formatGifTitle(value: string): string {
  const cleaned = value
    .replace(/\.gif$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\(\d+\)/g, " ")
    .replace(/\b(wired|lineal|linear|hover|pinch|animated|gif)\b/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return formatCollectionTitle(cleaned || value);
}

function createEditorFileName(fileName: string, stroke: StrokeWeight): string {
  const base = fileName.replace(/\.gif$/i, "");
  return `${base}-edited-${stroke}.gif`;
}

function createBulkExportFileName(fileName: string): string {
  const base = fileName.replace(/\.gif$/i, "");
  return `${base}-bulk-export.gif`;
}

function waitForDownloadQueue(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 160);
  });
}

function hexToRgb(hex: string): Rgb | null {
  if (!isHexColor(hex)) return null;

  const value = Number.parseInt(hex.slice(1), 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;

  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function getLuminance({ r, g, b }: Rgb): number {
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

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function getContrastColor(hex: string): string {
  if (!isHexColor(hex)) return "#ffffff";

  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 150 ? "#121330" : "#ffffff";
}
