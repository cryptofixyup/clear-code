import 'server-only';
import { createGCounter, increment, value } from '../delta-crdt';
import type { GCounter, CounterDelta } from '../delta-crdt';

export type MetricName = 'page_views' | 'api_calls' | 'events_processed' | 'errors';

const METRIC_NAMES: readonly MetricName[] = [
  'page_views', 'api_calls', 'events_processed', 'errors',
];

interface MetricEntry {
  counter: GCounter;
  history: Array<{ ts: number; val: number }>;
}

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

export function recordEvent(metric: MetricName, count = 1): CounterDelta {
  const entry = getOrCreate(metric);
  let [counter, lastDelta] = increment(entry.counter);
  for (let i = 1; i < count; i++) {
    [counter, lastDelta] = increment(counter);
  }
  entry.counter = counter;
  const current = value(counter);
  entry.history.push({ ts: Date.now(), val: current });
  if (entry.history.length > MAX_HISTORY) {
    entry.history.shift();
  }
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

export function _resetForTesting(): void {
  store.clear();
}
