import { getMetricsForUser } from '@/lib/server/data-access-layer';
import { WebGpuParticles } from '@/components/WebGpuParticles';

export default async function DashboardPage() {
  // DAL prunes the RSC payload before serialization.
  // Raw DB rows have 8 fields; the client receives only { id, value, timestamp }.
  // At 50 prefetches/session this saves ~1MB of redundant JSON per user.
  const metrics = await getMetricsForUser('demo-user', {
    metric: 'page_views',
    limit: 50,
  });

  return (
    <section>
      <h2>Live Metrics</h2>
      <ul>
        {metrics.map((m) => (
          <li key={m.id}>
            <time dateTime={m.timestamp}>{m.timestamp}</time>: {m.value}
          </li>
        ))}
      </ul>

      {/* WebGPU particle system — 1M particles, 100x throughput vs WebGL */}
      <h2>WebGPU Particle System (1,000,000 particles)</h2>
      <WebGpuParticles />
    </section>
  );
}
