import 'server-only';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Generic, debounced snapshot persistence.
//
// The metrics store is an in-memory CRDT — on a process restart it would reset
// to zero. This module periodically writes a snapshot to a StateStore and
// reloads it on startup. Because the G-Counter merge is idempotent and
// monotonic, reloading a persisted snapshot is just a normal merge: the same
// operation used for partition recovery. No special "restore" path is needed.

export interface StateStore {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
}

// File-backed store with atomic write (temp file + rename) so a crash mid-write
// never leaves a half-written, corrupt snapshot.
export class FileStateStore implements StateStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string | null> {
    try {
      return await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(data: string): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}

export function defaultStatePath(): string {
  return (
    process.env.METRICS_STATE_PATH ??
    path.join(os.tmpdir(), 'nextjs-perf-metrics.json')
  );
}

export interface Persister<T> {
  // Load the persisted snapshot, or null if absent/corrupt.
  load(): Promise<T | null>;
  // Record that state changed; the actual write is debounced and coalesced.
  scheduleSave(getState: () => T): void;
  // Force any pending write to complete now (e.g. on shutdown).
  flush(): Promise<void>;
  // Cancel a pending debounced write without flushing.
  stop(): void;
}

export interface PersisterOptions<T> {
  store: StateStore;
  debounceMs?: number;
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
}

export function createPersister<T>(opts: PersisterOptions<T>): Persister<T> {
  const debounceMs = opts.debounceMs ?? 1000;
  const serialize = opts.serialize ?? ((v: T) => JSON.stringify(v));
  const deserialize = opts.deserialize ?? ((raw: string) => JSON.parse(raw) as T);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => T) | null = null;
  let saving = false;

  async function doSave(): Promise<void> {
    // A write in flight, or nothing queued — nothing to do right now.
    if (pending === null || saving) return;
    saving = true;
    try {
      const getState = pending;
      pending = null;
      await opts.store.write(serialize(getState()));
    } finally {
      saving = false;
    }
  }

  return {
    async load(): Promise<T | null> {
      const raw = await opts.store.read();
      if (raw === null) return null;
      try {
        return deserialize(raw);
      } catch {
        // Corrupt snapshot — treat as no prior state rather than crashing.
        return null;
      }
    },

    scheduleSave(getState: () => T): void {
      pending = getState;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void doSave();
      }, debounceMs);
    },

    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await doSave();
    },

    stop(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
