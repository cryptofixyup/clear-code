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

  // 503 signals the load balancer to stop routing traffic; Kubernetes will
  // restart the pod rather than OOM-killing it mid-request.
  const httpStatus = pressure.rssBytes > 1.8 * 1024 ** 3 ? 503 : 200;

  return NextResponse.json(
    {
      status: httpStatus === 200 ? 'ok' : 'memory_pressure',
      rssGb: (pressure.rssBytes / 1024 ** 3).toFixed(2),
      heapUsedMb: (pressure.heapUsedBytes / 1024 ** 2).toFixed(1),
      heapTotalMb: (pressure.heapTotalBytes / 1024 ** 2).toFixed(1),
      externalMb: (pressure.externalBytes / 1024 ** 2).toFixed(1),
      gcTriggered,
    },
    { status: httpStatus },
  );
}
