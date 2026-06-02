import { Suspense } from 'react';
import { DashboardMetrics } from '@/components/DashboardMetrics';

// Partial Prerendering (PPR): this static shell is prerendered at build time
// and served from the CDN edge cache (<10ms TTFB). Only the Suspense boundary
// below is dynamic — it streams in after the shell as server queries resolve.
export default function HomePage() {
  return (
    <main>
      <header>
        <h1>Performance Dashboard</h1>
        <nav>
          <a href="/dashboard">Full Dashboard</a>
          <a href="/api/health">Health Check</a>
        </nav>
      </header>
      {/* Static content above is edge-cached; dynamic content below streams in */}
      <Suspense fallback={<MetricsSkeleton />}>
        <DashboardMetrics userId="demo" />
      </Suspense>
    </main>
  );
}

function MetricsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading metrics"
      style={{ width: '100%', height: 200, background: '#f0f0f0', borderRadius: 8 }}
    />
  );
}
