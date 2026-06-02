import { type NextRequest, NextResponse } from 'next/server';
import { exportSnapshot, mergeRemoteSnapshot } from '@/lib/server/metrics-store';
import { assertSyncPayload } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Bidirectional gossip: merge the caller's state, return our converged snapshot
// so the caller can reconcile too. Repeated/duplicate calls are safe (idempotent).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();
    const payload = assertSyncPayload(body);
    const converged = mergeRemoteSnapshot(payload.metrics);
    return NextResponse.json({ ok: true, nodeId: payload.nodeId, metrics: converged });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid sync payload';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// Export current per-node state for inspection or pull-based sync.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(exportSnapshot());
}
