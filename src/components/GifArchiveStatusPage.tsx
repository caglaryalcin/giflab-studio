"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  FolderSearch,
  HardDrive,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { GifIndexStatus, GifIndexStatusResponse, GifIndexSummary } from "@/types";

type ThemeMode = "light" | "dark";

type StatusRequestState = "idle" | "loading" | "error";

export function GifArchiveStatusPage() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [data, setData] = useState<GifIndexStatusResponse | null>(null);
  const [requestState, setRequestState] = useState<StatusRequestState>("loading");
  const [requestError, setRequestError] = useState("");
  const [starting, setStarting] = useState(false);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    setRequestState((current) => (current === "idle" ? "idle" : "loading"));
    setRequestError("");

    try {
      const response = await fetch("/api/gifs/index", {
        cache: "no-store",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Status request failed: ${response.status}`);
      }

      const nextData = (await response.json()) as GifIndexStatusResponse;

      if (!signal?.aborted) {
        setData(nextData);
        setRequestState("idle");
      }
    } catch (error) {
      if (!signal?.aborted) {
        setRequestState("error");
        setRequestError(error instanceof Error ? error.message : "Status request failed");
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
    const controller = new AbortController();
    void loadStatus(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadStatus]);

  useEffect(() => {
    const intervalMs = data?.status.running ? 700 : 3500;
    const interval = window.setInterval(() => {
      void loadStatus();
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [data?.status.running, loadStatus]);

  const summary = data?.summary ?? createEmptySummary();
  const status = normalizeDisplayStatus(data?.status ?? createEmptyStatus(), summary);
  const progressStyle = useMemo(
    () =>
      ({
        "--index-progress": `${Math.max(0, Math.min(100, status.progress))}%`,
      }) as CSSProperties,
    [status.progress],
  );
  const isIndeterminate = status.running && status.totalFiles === 0;
  const canStart = !status.running && !starting;
  const canPause = status.running && !starting;

  async function startIndexing() {
    setStarting(true);
    setRequestError("");

    try {
      const response = await fetch("/api/gifs/index", {
        cache: "no-store",
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Index request failed: ${response.status}`);
      }

      const nextData = (await response.json()) as GifIndexStatusResponse;
      setData(nextData);
      setRequestState("idle");
    } catch (error) {
      setRequestState("error");
      setRequestError(error instanceof Error ? error.message : "Index request failed");
    } finally {
      setStarting(false);
    }
  }

  async function pauseIndexing() {
    setStarting(true);
    setRequestError("");

    try {
      const response = await fetch("/api/gifs/index", {
        body: JSON.stringify({ action: "pause" }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Pause request failed: ${response.status}`);
      }

      const nextData = (await response.json()) as GifIndexStatusResponse;
      setData(nextData);
      setRequestState("idle");
    } catch (error) {
      setRequestState("error");
      setRequestError(error instanceof Error ? error.message : "Pause request failed");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="gif-app gif-status-app" data-theme={theme}>
      <header className="gif-topbar gif-status-topbar">
        <Link className="gif-brand" href="/" aria-label="GifLab Studio">
          <span className="gif-brand__mark">
            <Activity size={20} strokeWidth={2.4} />
          </span>
          <span>
            <strong>GifLab</strong>
            <small>Studio</small>
          </span>
        </Link>

        <div className="gif-topbar__right">
          <Link className="gif-status-nav-button" href="/">
            <ArrowLeft size={17} />
            <span>Archive</span>
          </Link>
          <button
            className="gif-status-primary"
            disabled={status.running ? !canPause : !canStart}
            onClick={status.running ? pauseIndexing : startIndexing}
            type="button"
          >
            {starting ? <RefreshCw className="is-spinning" size={17} /> : getPrimaryActionIcon(status)}
            <span>{getPrimaryActionLabel(status, starting)}</span>
          </button>
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

      <main className="gif-status-workspace">
        <section className="gif-status-hero" aria-labelledby="gif-status-title">
          <div>
            <span className="gif-kicker">Archive index</span>
            <h1 id="gif-status-title">Index status</h1>
          </div>
          <StatusBadge status={status} summary={summary} />
        </section>

        {requestState === "error" ? (
          <p className="gif-error gif-status-error">
            <AlertTriangle size={18} />
            {requestError}
          </p>
        ) : null}

        <section className="gif-status-progress-panel">
          <div className="gif-status-progress-head">
            <div>
              <span>{formatPhase(status)}</span>
              <strong>{status.message || "Index is idle"}</strong>
            </div>
            <b>{isIndeterminate ? "Finding" : `${Math.round(status.progress)}%`}</b>
          </div>
          <div
            className={isIndeterminate ? "gif-status-progress is-indeterminate" : "gif-status-progress"}
            style={progressStyle}
          >
            <span />
          </div>
          <div className="gif-status-current">
            <Clock3 size={15} />
            <span>{status.currentPath || formatStatusTime(status, summary)}</span>
          </div>
        </section>

        <section className="gif-status-metrics" aria-label="Index metrics">
          <StatusMetric
            icon={<Database size={20} />}
            label="Indexed"
            value={formatIndexedValue(status, summary)}
          />
          <StatusMetric
            icon={<FolderSearch size={20} />}
            label="Found"
            value={formatNumber(status.discoveredFiles || summary.count)}
          />
          <StatusMetric
            icon={<HardDrive size={20} />}
            label="Directories"
            value={formatNumber(status.scannedDirectories)}
          />
          <StatusMetric
            icon={<CheckCircle2 size={20} />}
            label="Last index"
            value={formatDate(summary.scannedAt || status.completedAt)}
          />
        </section>

        <section className="gif-status-details" aria-label="Archive details">
          <DetailRow label="Archive root" value={summary.rootLabel || status.rootLabel || "public/gif-archive"} />
          <DetailRow label="Catalog cache" value={formatCacheState(summary)} />
          <DetailRow label="Cache TTL" value={formatDuration(summary.cacheTtlMs)} />
          <DetailRow label="Runtime" value={status.durationMs > 0 ? formatDuration(status.durationMs) : "Idle"} />
          <DetailRow label="File proxy" value={summary.usesFileProxy ? "Enabled" : "Static public paths"} />
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ status, summary }: { status: GifIndexStatus; summary: GifIndexSummary }) {
  if (status.phase === "error") {
    return (
      <span className="gif-status-badge is-error">
        <AlertTriangle size={16} />
        Error
      </span>
    );
  }

  if (status.running) {
    return (
      <span className="gif-status-badge is-running">
        <RefreshCw className="is-spinning" size={16} />
        Running
      </span>
    );
  }

  if (status.phase === "paused") {
    return (
      <span className="gif-status-badge">
        <Pause size={16} />
        Paused
      </span>
    );
  }

  if (summary.exists && !summary.stale) {
    return (
      <span className="gif-status-badge is-ready">
        <CheckCircle2 size={16} />
        Ready
      </span>
    );
  }

  return (
    <span className="gif-status-badge">
      <Clock3 size={16} />
      Waiting
    </span>
  );
}

function StatusMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <article className="gif-status-metric">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="gif-status-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function createEmptyStatus(): GifIndexStatus {
  return {
    completedAt: "",
    currentPath: "",
    discoveredFiles: 0,
    durationMs: 0,
    error: "",
    indexedFiles: 0,
    message: "Loading status",
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

function createEmptySummary(): GifIndexSummary {
  return {
    cacheTtlMs: 0,
    count: 0,
    exists: false,
    rootLabel: "",
    scannedAt: "",
    stale: true,
    usesFileProxy: false,
  };
}

function normalizeDisplayStatus(status: GifIndexStatus, summary: GifIndexSummary): GifIndexStatus {
  if (status.running || status.phase === "paused" || status.phase === "error" || !summary.exists) {
    return status;
  }

  if (status.phase !== "idle" && status.progress > 0) {
    return status;
  }

  return {
    ...status,
    completedAt: summary.scannedAt,
    currentPath: "",
    discoveredFiles: summary.count,
    indexedFiles: summary.count,
    message: `Indexed ${formatNumber(summary.count)} GIFs`,
    phase: "ready",
    progress: 100,
    rootLabel: summary.rootLabel,
    totalFiles: summary.count,
    updatedAt: summary.scannedAt,
  };
}

function formatPhase(status: GifIndexStatus): string {
  if (status.phase === "discovering") return "Discovering";
  if (status.phase === "indexing") return "Indexing";
  if (status.phase === "warming") return "Preparing posters";
  if (status.phase === "writing") return "Saving";
  if (status.phase === "paused") return "Paused";
  if (status.phase === "ready") return "Ready";
  if (status.phase === "error") return "Error";
  return "Idle";
}

function getPrimaryActionIcon(status: GifIndexStatus) {
  if (status.running) return <Pause size={17} />;
  if (status.phase === "paused") return <Play size={17} />;
  return <FolderSearch size={17} />;
}

function getPrimaryActionLabel(status: GifIndexStatus, starting: boolean): string {
  if (starting && status.running) return "Pausing";
  if (starting) return "Starting";
  if (status.running) return "Pause";
  if (status.phase === "paused") return "Resume";
  return "Re-index";
}

function formatIndexedValue(status: GifIndexStatus, summary: GifIndexSummary): string {
  if (status.totalFiles > 0) {
    return `${formatNumber(status.indexedFiles)} / ${formatNumber(status.totalFiles)}`;
  }

  return formatNumber(summary.count);
}

function formatStatusTime(status: GifIndexStatus, summary: GifIndexSummary): string {
  if (status.running && status.startedAt) return `Started ${formatDate(status.startedAt)}`;
  if (summary.scannedAt) return `Last indexed ${formatDate(summary.scannedAt)}`;
  return "No index has been written yet";
}

function formatCacheState(summary: GifIndexSummary): string {
  if (!summary.exists) return "No manifest";
  return summary.stale ? "Manifest is stale" : "Manifest is fresh";
}

function formatDate(value: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 ms";
  if (value < 1000) return `${Math.round(value)} ms`;

  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} sec`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes} min ${remainingSeconds} sec`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
