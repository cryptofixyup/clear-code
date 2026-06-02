import 'server-only';
import { createGCounter, increment, merge, value } from '../delta-crdt';
import type { GCounter, CounterDelta, NodeId } from '../delta-crdt';

export type MetricName = 'page_views' | 'api_calls' | 'events_processed' | 'errors';

const METRIC_NAMES: readonly MetricName[] = [
  'page_views', 'api_calls', 'events_processed', 'errors',
];

function isMetricName(name: string): name is MetricName {
  return (METRIC_NAMES as readonly string[]).includes(name);
}

interface MetricEntry {
  counter: GCounter;
  history: Array<{ ts: number; val: number }>;
}

// Per-metric wire shape: { [nodeId]: count }. A SyncSnapshot carries every metric.
export type MetricStateWire = Record<NodeId, number>;
export type SyncSnapshot = Partial<Record<MetricName, MetricStateWire>>;

const NODE_ID = process.env.HOSTNAME ?? 'node-0';
const MAX_HISTORY = 60;

const store = new Map<MetricName, MetricEntry>();

function getOrCreate(metric: MetricName): MetricEntry {
  let entry = store.get(metric);
  if (entry === undefined) {
    entry = { counter: createGCounter(NODE_ID), history: [] };
    store.set(metric, entry);
  }
  return entry;
}

function pushHistory(entry: MetricEntry, current: number): void {
  entry.history.push({ ts: Date.now(), val: current });
  if (entry.history.length > MAX_HISTORY) {
    entry.history.shift();
  }
}

export function recordEvent(metric: MetricName, count = 1): CounterDelta {
  const entry = getOrCreate(metric);
  let [counter, lastDelta] = increment(entry.counter);
  for (let i = 1; i < count; i++) {
    [counter, lastDelta] = increment(counter);
  }
  entry.counter = counter;
  pushHistory(entry, value(counter));
  return lastDelta;
}

export function getMetrics(): Record<MetricName, number> {
  return Object.fromEntries(
    METRIC_NAMES.map((name) => [name, value(getOrCreate(name).counter)])
  ) as Record<MetricName, number>;
}

export function getHistory(metric: MetricName): Array<{ ts: number; val: number }> {
  return [...getOrCreate(metric).history];
}

// Full time-series for every metric — drives the WebGPU chart.
export function getAllHistory(): Record<MetricName, Array<{ ts: number; val: number }>> {
  return Object.fromEntries(
    METRIC_NAMES.map((name) => [name, [...getOrCreate(name).history]])
  ) as Record<MetricName, Array<{ ts: number; val: number }>>;
}

// Export the full per-node state for every metric — used for gossip / partition recovery.
export function exportSnapshot(): SyncSnapshot {
  const snapshot: SyncSnapshot = {};
  for (const name of METRIC_NAMES) {
    snapshot[name] = Object.fromEntries(getOrCreate(name).counter.state);
  }
  return snapshot;
}

// Merge a remote node's snapshot into local state via the G-Counter's
// max-per-node merge (commutative + idempotent). Returns the converged snapshot.
// Unknown metric keys in the remote payload are ignored.
export function mergeRemoteSnapshot(remote: SyncSnapshot): SyncSnapshot {
  for (const [name, remoteState] of Object.entries(remote)) {
    if (!isMetricName(name) || remoteState === undefined) continue;
    const entry = getOrCreate(name);
    const remoteCounter: GCounter = {
      nodeId: 'remote',
      state: new Map(
        Object.entries(remoteState).map(([node, n]) => [node, Number(n)])
      ),
    };
    // merge keeps the local nodeId; only counts reconcile upward.
    entry.counter = merge(entry.counter, remoteCounter);
    pushHistory(entry, value(entry.counter));
  }
  return exportSnapshot();
}

export function _resetForTesting(): void {
  store.clear();
}
