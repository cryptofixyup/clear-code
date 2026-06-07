import { NextResponse } from 'next/server';
import { checkMemoryPressure, triggerGcIfNeeded } from '@/lib/memory-health';

export const dynamic = 'force-dynamic';

// Memory health endpoint for the OOM paradox mitigation (section 7.2).
// Called by container liveness probes; also invoked by fluid-compute cycles.
// Requires: node --expose-gc --max-old-space-size=2048 server.js
export async function GET(): Promise<NextResponse> {
  const pressure = checkMemoryPressure();

  let gcTriggered = false;
  if (pressure.shouldGc) {
    gcTriggered = await triggerGcIfNeeded();
  }

  // Re-snapshot after GC so status reflects the recovered state rather than
  // the pre-GC RSS that triggered collection — avoids spurious 503s from
  // transient spikes that GC already reclaimed.
  const snapshot = gcTriggered ? checkMemoryPressure() : pressure;

  // 503 signals the load balancer to stop routing traffic; Kubernetes will
  // restart the pod rather than OOM-killing it mid-request.
  const httpStatus = snapshot.rssBytes > 1.8 * 1024 ** 3 ? 503 : 200;

  return NextResponse.json(
    {
      status: httpStatus === 200 ? 'ok' : 'memory_pressure',
      rssGb: (snapshot.rssBytes / 1024 ** 3).toFixed(2),
      heapUsedMb: (snapshot.heapUsedBytes / 1024 ** 2).toFixed(1),
      heapTotalMb: (snapshot.heapTotalBytes / 1024 ** 2).toFixed(1),
      externalMb: (snapshot.externalBytes / 1024 ** 2).toFixed(1),
      gcTriggered,
    },
    { status: httpStatus },
  );
}
