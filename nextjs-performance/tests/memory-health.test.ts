import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkMemoryPressure,
  triggerGcIfNeeded,
  createMemoryMonitor,
} from '../lib/memory-health.js';

describe('checkMemoryPressure', () => {
  it('returns a snapshot with positive numeric fields', () => {
    const snap = checkMemoryPressure();
    expect(typeof snap.rssBytes).toBe('number');
    expect(typeof snap.heapUsedBytes).toBe('number');
    expect(typeof snap.heapTotalBytes).toBe('number');
    expect(typeof snap.externalBytes).toBe('number');
    expect(typeof snap.shouldGc).toBe('boolean');
    expect(snap.rssBytes).toBeGreaterThan(0);
    expect(snap.heapUsedBytes).toBeGreaterThan(0);
  });

  it('shouldGc is false under normal test-process memory', () => {
    // Test processes are far below the 1.5GB threshold
    expect(checkMemoryPressure().shouldGc).toBe(false);
  });

  it('shouldGc is true when RSS is above the threshold', () => {
    const real = process.memoryUsage;
    process.memoryUsage = () => ({
      ...real.call(process),
      rss: 2 * 1024 ** 3, // 2GB — above 1.5GB threshold
    });
    try {
      expect(checkMemoryPressure().shouldGc).toBe(true);
    } finally {
      process.memoryUsage = real;
    }
  });
});

describe('triggerGcIfNeeded', () => {
  it('returns false when global.gc is unavailable', async () => {
    const originalGc = global.gc;
    // @ts-expect-error — intentionally clearing gc to test the guard
    delete global.gc;
    try {
      expect(await triggerGcIfNeeded()).toBe(false);
    } finally {
      if (originalGc) global.gc = originalGc;
    }
  });

  it('calls global.gc and returns true when exposed', async () => {
    const spy = vi.fn();
    const originalGc = global.gc;
    // @ts-expect-error — injecting stub
    global.gc = spy;
    try {
      expect(await triggerGcIfNeeded()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      global.gc = originalGc;
    }
  });
});

describe('createMemoryMonitor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts and stops without throwing', () => {
    const monitor = createMemoryMonitor({ intervalMs: 1000 });
    expect(() => { monitor.start(); monitor.stop(); }).not.toThrow();
  });

  it('calls onPressure when RSS exceeds threshold', async () => {
    const real = process.memoryUsage;
    process.memoryUsage = () => ({ ...real.call(process), rss: 2 * 1024 ** 3 });

    const onPressure = vi.fn();
    const monitor = createMemoryMonitor({ intervalMs: 100, onPressure });
    monitor.start();
    await vi.advanceTimersByTimeAsync(110);
    monitor.stop();
    process.memoryUsage = real;

    expect(onPressure).toHaveBeenCalled();
  });

  it('does not call onPressure under normal memory', async () => {
    const onPressure = vi.fn();
    const monitor = createMemoryMonitor({ intervalMs: 100, onPressure });
    monitor.start();
    await vi.advanceTimersByTimeAsync(110);
    monitor.stop();
    expect(onPressure).not.toHaveBeenCalled();
  });
});
