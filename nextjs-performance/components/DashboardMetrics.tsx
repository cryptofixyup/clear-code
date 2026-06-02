import { fetchHighPerformanceData } from '@/lib/server/cache';

type Props = { userId: string };

// Dynamic Server Component — streams in after the PPR static shell.
// Data is cached at the function level via 'use cache' + cacheLife('minutes').
// No client JS is shipped for this component.
export async function DashboardMetrics({ userId }: Props) {
  const data = await fetchHighPerformanceData(userId);

  return (
    <section aria-label="Live metrics">
      <h2>Live Metrics</h2>
      <pre style={{ overflow: 'auto', padding: 16, background: '#f8f8f8', borderRadius: 8 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}
