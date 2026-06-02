import { NextResponse } from 'next/server';
import { getAllHistory } from '@/lib/server/metrics-store';

export const dynamic = 'force-dynamic';

// Full per-metric time-series consumed by the WebGPU chart (polled every ~2s).
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getAllHistory());
}
