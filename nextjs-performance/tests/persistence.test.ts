import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('server-only', () => ({}));

import {
  createPersister,
  FileStateStore,
  type StateStore,
} from '../lib/server/persistence';

// Minimal in-memory store for fast, deterministic persister tests.
class MemoryStore implements StateStore {
  data: string | null = null;
  writes = 0;
  async read(): Promise<string | null> {
    return this.data;
  }
  async write(data: string): Promise<void> {
    this.data = data;
    this.writes += 1;
  }
}

describe('createPersister', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('load() returns null when the store is empty', async () => {
    const persister = createPersister({ store: new MemoryStore() });
    expect(await persister.load()).toBeNull();
  });

  it('load() parses a stored snapshot', async () => {
    const store = new MemoryStore();
    store.data = JSON.stringify({ page_views: { 'node-0': 7 } });
    const persister = createPersister<Record<string, Record<string, number>>>({ store });
    expect(await persister.load()).toEqual({ page_views: { 'node-0': 7 } });
  });

  it('load() returns null on corrupt JSON instead of throwing', async () => {
    const store = new MemoryStore();
    store.data = '{ not valid json';
    const persister = createPersister({ store });
    await expect(persister.load()).resolves.toBeNull();
  });

  it('debounces and coalesces rapid saves into a single write', async () => {
    const store = new MemoryStore();
    const persister = createPersister<number>({ store, debounceMs: 1000 });

    persister.scheduleSave(() => 1);
    persister.scheduleSave(() => 2);
    persister.scheduleSave(() => 3);
    expect(store.writes).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.writes).toBe(1);
    expect(store.data).toBe('3'); // latest state wins
  });

  it('flush() writes the pending state immediately', async () => {
    const store = new MemoryStore();
    const persister = createPersister<number>({ store, debounceMs: 10_000 });

    persister.scheduleSave(() => 42);
    await persister.flush();

    expect(store.writes).toBe(1);
    expect(store.data).toBe('42');
  });

  it('stop() cancels a pending save', async () => {
    const store = new MemoryStore();
    const persister = createPersister<number>({ store, debounceMs: 1000 });

    persister.scheduleSave(() => 1);
    persister.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(store.writes).toBe(0);
  });

  it('uses a custom serializer when provided', async () => {
    const store = new MemoryStore();
    const persister = createPersister<{ n: number }>({
      store,
      debounceMs: 0,
      serialize: (v) => `N=${v.n}`,
    });
    persister.scheduleSave(() => ({ n: 5 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.data).toBe('N=5');
  });
});

describe('FileStateStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'persist-test-'));
    filePath = path.join(dir, 'state.json');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('read() returns null for a missing file', async () => {
    const store = new FileStateStore(filePath);
    expect(await store.read()).toBeNull();
  });

  it('round-trips data through write() then read()', async () => {
    const store = new FileStateStore(filePath);
    await store.write('{"hello":"world"}');
    expect(await store.read()).toBe('{"hello":"world"}');
  });

  it('overwrites prior content and leaves no temp file behind', async () => {
    const store = new FileStateStore(filePath);
    await store.write('first');
    await store.write('second');
    expect(await store.read()).toBe('second');

    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
  });
});
