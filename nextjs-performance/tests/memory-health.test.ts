import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkMemoryPressure,
  triggerGcIfNeeded,
  createMemoryMonitor,
} from '../lib/memory-health.js';

const BASE_USAGE = {
  heapTotal: 100 * 1024 * 1024,
  heapUsed:  50  * 1024 * 1024,
  external:  1   * 1024 * 1024,
  arrayBuffers: 0,
};

describe('checkMemoryPressure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a snapshot with positive numeric fields', () => {
    const snap = checkMemoryPressure();
    expect(snap.rssBytes).toBeGreaterThan(0);
    expect(snap.heapUsedBytes).toBeGreaterThan(0);
    expect(snap.heapTotalBytes).toBeGreaterThan(0);
    expect(typeof snap.shouldGc).toBe('boolean');
  });

  it('shouldGc is false under normal test-process memory', () => {
    expect(checkMemoryPressure().shouldGc).toBe(false);
  });

  it('shouldGc is true when RSS exceeds 1.5 GB', () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValueOnce({
      ...BASE_USAGE,
      rss: 2 * 1024 ** 3, // 2 GB
    });
    expect(checkMemoryPressure().shouldGc).toBe(true);
  });
});

describe('triggerGcIfNeeded', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns false when global.gc is unavailable', async () => {
    vi.stubGlobal('gc', undefined);
    expect(await triggerGcIfNeeded()).toBe(false);
  });

  it('calls global.gc and returns true when --expose-gc is active', async () => {
    const gcSpy = vi.fn();
    vi.stubGlobal('gc', gcSpy);
    expect(await triggerGcIfNeeded()).toBe(true);
    expect(gcSpy).toHaveBeenCalledOnce();
  });
});

describe('createMemoryMonitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('starts and stops without throwing', () => {
    const monitor = createMemoryMonitor({ intervalMs: 1000 });
    expect(() => { monitor.start(); monitor.stop(); }).not.toThrow();
  });

  it('fires onPressure callback when RSS exceeds threshold', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({ ...BASE_USAGE, rss: 2 * 1024 ** 3 });
    vi.stubGlobal('gc', vi.fn()); // prevent the 'GC unavailable' warning

    const onPressure = vi.fn();
    const monitor = createMemoryMonitor({ intervalMs: 100, onPressure });
    monitor.start();
    await vi.advanceTimersByTimeAsync(150);
    monitor.stop();

    expect(onPressure).toHaveBeenCalled();
  });

  it('does not fire onPressure under normal memory', async () => {
    const onPressure = vi.fn();
    const monitor = createMemoryMonitor({ intervalMs: 100, onPressure });
    monitor.start();
    await vi.advanceTimersByTimeAsync(150);
    monitor.stop();
    expect(onPressure).not.toHaveBeenCalled();
  });
});
