import { Suspense } from 'react';
import { getMetricsForUser } from '@/lib/server/data-access-layer';
import { WebGpuParticles } from '@/components/WebGpuParticles';
import LiveMetricsPanel from '@/components/LiveMetricsPanel';

export default async function DashboardPage() {
  // Static segment — part of the PPR shell, served from edge cache.
  // DAL prunes the RSC payload: raw DB rows have 8 fields; client gets { id, value, timestamp }.
  const metrics = await getMetricsForUser('demo-user', {
    metric: 'page_views',
    limit: 10,
  });

  return (
    <section style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '2rem' }}>
        Analytics Dashboard
      </h1>

      {/* Static shell — edge-cached, renders instantly on every request */}
      <section>
        <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>
          Recent Page Views
        </h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {metrics.map((m) => (
            <li key={m.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
              <time dateTime={m.timestamp} style={{ color: '#94a3b8', fontSize: '0.875rem' }}>{m.timestamp}</time>
              <span style={{ fontWeight: 600 }}>{m.value}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Dynamic island — Suspense boundary is the PPR cut point.
          The static shell above is sent immediately; this streams in behind it. */}
      <section style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>
          Real-time CRDT Counters
        </h2>
        <Suspense
          fallback={
            <div style={{ padding: '2rem', color: '#94a3b8', textAlign: 'center', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
              Connecting to live stream...
            </div>
          }
        >
          <LiveMetricsPanel />
        </Suspense>
      </section>

      {/* WebGPU particle system — 1M particles, Render Bundles, explicit GPU cleanup */}
      <section style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>
          WebGPU Particle System (1,000,000 particles)
        </h2>
        <WebGpuParticles />
      </section>
    </section>
  );
}
