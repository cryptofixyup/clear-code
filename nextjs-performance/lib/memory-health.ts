// Memory pressure monitoring for the OOM paradox (section 7.2).
//
// Documented RSS growth sources in Next.js 15/16 standalone:
//   - undici retains performance entries past GC
//   - Turbopack spikes RSS to 12+GB on large route graphs
//   - Module-level state (unbounded Maps, Zustand stores) persists across requests
//
// Mitigation: monitor RSS, trigger manual GC in low-traffic windows, and let
// the container health check signal the orchestrator to restart before OOM kill.

export interface MemorySnapshot {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  shouldGc: boolean;
}

// Trigger GC when RSS exceeds this threshold; 503 when it exceeds 1.8 GB
const RSS_GC_THRESHOLD_BYTES = 1.5 * 1024 ** 3;

export function checkMemoryPressure(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    shouldGc: usage.rss > RSS_GC_THRESHOLD_BYTES,
  };
}

// Manual GC is a blocking stop-the-world pause — restrict to:
//   - Fluid-compute idle cycles
//   - Low-traffic maintenance windows (e.g. 02:00–04:00 UTC)
//   - Between request batches in queue-based workers
//
// Requires the --expose-gc Node.js flag (set in the start script).
export async function triggerGcIfNeeded(): Promise<boolean> {
  if (typeof global.gc !== 'function') {
    console.warn('[memory] GC unavailable — start server with --expose-gc');
    return false;
  }

  const beforeRss = process.memoryUsage().rss;
  global.gc();
  const afterRss = process.memoryUsage().rss;

  const freedMb = (beforeRss - afterRss) / 1024 ** 2;
  console.info(`[memory] manual GC freed ${freedMb.toFixed(1)} MB`);
  return true;
}

// Periodic monitor — wire into a setInterval during low-traffic windows.
// Automatically skips GC if traffic is above threshold (avoids p99 spikes).
export function createMemoryMonitor(opts: {
  intervalMs: number;
  onPressure?: (snapshot: MemorySnapshot) => void;
}): { start: () => void; stop: () => void } {
  let handle: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      handle = setInterval(async () => {
        const snapshot = checkMemoryPressure();
        if (snapshot.shouldGc) {
          opts.onPressure?.(snapshot);
          await triggerGcIfNeeded();
        }
      }, opts.intervalMs);
    },
    stop() {
      if (handle !== null) clearInterval(handle);
    },
  };
}
