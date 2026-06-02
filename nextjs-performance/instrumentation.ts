// Next.js instrumentation hook — runs once per server process on startup.
// We use it to hydrate the in-memory metrics CRDT from its persisted snapshot
// and to begin debounced saving, so counters survive process restarts.
//
// Guarded to the Node.js runtime: the Edge runtime has no filesystem and the
// metrics store / persistence modules are server-only.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initPersistence } = await import('./lib/server/metrics-persistence');
    await initPersistence();
  }
}
