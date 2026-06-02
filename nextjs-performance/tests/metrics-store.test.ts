import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock before metrics-store is evaluated so 'server-only' never throws
vi.mock('server-only', () => ({}));

import { _resetForTesting, getHistory, getMetrics, recordEvent } from '../lib/server/metrics-store';

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
