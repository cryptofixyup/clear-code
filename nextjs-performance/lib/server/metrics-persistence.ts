import 'server-only';
import { exportSnapshot, mergeRemoteSnapshot, subscribe } from './metrics-store';
import type { SyncSnapshot } from './metrics-store';
import {
  createPersister,
  defaultStatePath,
  FileStateStore,
  type StateStore,
} from './persistence';

// Wires the in-memory metrics store to a durable snapshot store:
//   startup  → load snapshot, merge into the CRDT (idempotent recovery)
//   on change → debounced save of the current snapshot
//   shutdown → flush any pending save
//
// The store stays I/O-free; this glue is the only place that touches disk.

const SAVE_DEBOUNCE_MS = 2000;

let started = false;

export interface PersistenceHandle {
  stop(): Promise<void>;
}

export async function initPersistence(store?: StateStore): Promise<PersistenceHandle> {
  if (started) {
    return { stop: async () => {} };
  }
  started = true;

  const persister = createPersister<SyncSnapshot>({
    store: store ?? new FileStateStore(defaultStatePath()),
    debounceMs: SAVE_DEBOUNCE_MS,
  });

  // Recover prior counts. merge() is monotonic + idempotent, so this is safe
  // even if the process restarted mid-write or the snapshot is slightly stale.
  const saved = await persister.load();
  if (saved !== null) {
    mergeRemoteSnapshot(saved);
  }

  const unsubscribe = subscribe(() => {
    persister.scheduleSave(() => exportSnapshot());
  });

  // Best-effort durable flush on container shutdown signals.
  const onShutdown = (): void => {
    void persister.flush();
  };
  process.once('SIGTERM', onShutdown);
  process.once('SIGINT', onShutdown);

  return {
    stop: async () => {
      unsubscribe();
      process.removeListener('SIGTERM', onShutdown);
      process.removeListener('SIGINT', onShutdown);
      await persister.flush();
    },
  };
}
