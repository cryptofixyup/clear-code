import { type NextRequest, NextResponse } from 'next/server';
import { recordEvent } from '@/lib/server/metrics-store';
import { assertEventPayload } from '@/lib/validation';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();
    const payload = assertEventPayload(body);
    const delta = recordEvent(payload.event, payload.count ?? 1);
    return NextResponse.json({ ok: true, delta: { createdAt: delta.createdAt } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid payload';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
