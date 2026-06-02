import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock before metrics-store is evaluated so 'server-only' never throws
vi.mock('server-only', () => ({}));

import {
  _resetForTesting,
  exportSnapshot,
  getAllHistory,
  getHistory,
  getMetrics,
  mergeRemoteSnapshot,
  recordEvent,
  subscribe,
} from '../lib/server/metrics-store';

describe('metrics-store', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('starts all counters at zero', () => {
    const m = getMetrics();
    expect(m.page_views).toBe(0);
    expect(m.api_calls).toBe(0);
    expect(m.events_processed).toBe(0);
    expect(m.errors).toBe(0);
  });

  it('increments a counter by 1 by default', () => {
    recordEvent('page_views');
    expect(getMetrics().page_views).toBe(1);
  });

  it('increments a counter by the given count', () => {
    recordEvent('api_calls', 5);
    expect(getMetrics().api_calls).toBe(5);
  });

  it('accumulates across multiple calls', () => {
    recordEvent('errors');
    recordEvent('errors');
    recordEvent('errors', 3);
    expect(getMetrics().errors).toBe(5);
  });

  it('tracks independent counters separately', () => {
    recordEvent('page_views', 10);
    recordEvent('api_calls', 3);
    const m = getMetrics();
    expect(m.page_views).toBe(10);
    expect(m.api_calls).toBe(3);
    expect(m.events_processed).toBe(0);
  });

  it('returns the last delta from recordEvent', () => {
    const delta = recordEvent('page_views', 2);
    expect(delta.createdAt).toBeTypeOf('number');
    expect(delta.increments.size).toBeGreaterThan(0);
  });

  it('records history entries', () => {
    recordEvent('page_views');
    recordEvent('page_views');
    const history = getHistory('page_views');
    expect(history).toHaveLength(2);
    expect(history[0]?.val).toBe(1);
    expect(history[1]?.val).toBe(2);
  });

  it('caps history at 60 entries', () => {
    for (let i = 0; i < 65; i++) {
      recordEvent('api_calls');
    }
    expect(getHistory('api_calls')).toHaveLength(60);
  });
});

describe('metrics-store — multi-region sync', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('exports per-node state for every metric', () => {
    recordEvent('page_views', 2);
    const snap = exportSnapshot();
    expect(snap.page_views).toBeDefined();
    expect(snap.api_calls).toBeDefined();
    const total = Object.values(snap.page_views ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
  });

  it('converges local + remote contributions into the combined total', () => {
    recordEvent('page_views', 3);
    mergeRemoteSnapshot({ page_views: { 'node-1': 5 } });
    expect(getMetrics().page_views).toBe(8);
  });

  it('is idempotent — merging the same remote snapshot twice does not double count', () => {
    mergeRemoteSnapshot({ api_calls: { 'node-1': 5 } });
    mergeRemoteSnapshot({ api_calls: { 'node-1': 5 } });
    expect(getMetrics().api_calls).toBe(5);
  });

  it('accumulates contributions from distinct remote nodes', () => {
    mergeRemoteSnapshot({ errors: { 'node-1': 2 } });
    mergeRemoteSnapshot({ errors: { 'node-2': 3 } });
    expect(getMetrics().errors).toBe(5);
  });

  it('takes the max per node — stale lower values are ignored', () => {
    mergeRemoteSnapshot({ page_views: { 'node-1': 10 } });
    mergeRemoteSnapshot({ page_views: { 'node-1': 4 } });
    expect(getMetrics().page_views).toBe(10);
  });

  it('ignores unknown metric keys in a remote payload', () => {
    mergeRemoteSnapshot({ bogus_metric: { 'node-1': 99 } } as never);
    const m = getMetrics();
    expect(m.page_views).toBe(0);
    expect(m.api_calls).toBe(0);
  });

  it('round-trips: a merged snapshot re-applied is a no-op', () => {
    recordEvent('events_processed', 4);
    mergeRemoteSnapshot({ events_processed: { 'node-1': 6 } });
    const snap = exportSnapshot();
    const before = getMetrics().events_processed;
    mergeRemoteSnapshot(snap);
    expect(getMetrics().events_processed).toBe(before);
  });
});

describe('metrics-store — getAllHistory (chart feed)', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('returns an entry for every metric', () => {
    const all = getAllHistory();
    expect(Object.keys(all).sort()).toEqual(
      ['api_calls', 'errors', 'events_processed', 'page_views']
    );
  });

  it('returns empty series before any events', () => {
    const all = getAllHistory();
    expect(all.page_views).toEqual([]);
    expect(all.errors).toEqual([]);
  });

  it('reflects recorded events as monotonic series', () => {
    recordEvent('page_views');
    recordEvent('page_views');
    recordEvent('api_calls', 3);
    const all = getAllHistory();
    expect(all.page_views.map((p) => p.val)).toEqual([1, 2]);
    expect(all.api_calls.at(-1)?.val).toBe(3);
  });

  it('caps each series at 60 points', () => {
    for (let i = 0; i < 70; i++) recordEvent('errors');
    expect(getAllHistory().errors).toHaveLength(60);
  });

  it('returns copies — mutating the result does not corrupt the store', () => {
    recordEvent('page_views');
    const all = getAllHistory();
    all.page_views.push({ ts: 0, val: 999 });
    expect(getHistory('page_views')).toHaveLength(1);
  });
});

describe('metrics-store — change subscription (persistence hook)', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('notifies subscribers on recordEvent', () => {
    const listener = vi.fn();
    subscribe(listener);
    recordEvent('page_views');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on mergeRemoteSnapshot', () => {
    const listener = vi.fn();
    subscribe(listener);
    mergeRemoteSnapshot({ api_calls: { 'node-1': 3 } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    recordEvent('errors');
    unsubscribe();
    recordEvent('errors');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports multiple independent subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    recordEvent('events_processed');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
