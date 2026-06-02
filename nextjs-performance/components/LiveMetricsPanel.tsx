'use client';

import { useEffect, useRef, useState } from 'react';

type MetricName = 'page_views' | 'api_calls' | 'events_processed' | 'errors';
type MetricsSnapshot = Record<MetricName, number>;

const METRIC_KEYS: MetricName[] = ['page_views', 'api_calls', 'events_processed', 'errors'];

const LABELS: Record<MetricName, string> = {
  page_views: 'Page Views',
  api_calls: 'API Calls',
  events_processed: 'Events Processed',
  errors: 'Errors',
};

const COLORS: Record<MetricName, string> = {
  page_views: '#3b82f6',
  api_calls: '#10b981',
  events_processed: '#8b5cf6',
  errors: '#ef4444',
};

// Simulated remote regions — each keeps its own monotonic per-metric counter.
const SIM_REGIONS = ['region-eu-west', 'region-ap-south'] as const;

const buttonStyle = (bg: string, disabled: boolean): React.CSSProperties => ({
  padding: '0.4rem 1rem',
  background: bg,
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
  fontSize: '0.8rem',
  fontWeight: 500,
});

export default function LiveMetricsPanel() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [firing, setFiring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Monotonic per-region, per-metric contributions held client-side so each
  // "Simulate Region" click advances the regions' own G-Counter entries.
  const regionRef = useRef<Record<MetricName, Record<string, number>>>({
    page_views: {},
    api_calls: {},
    events_processed: {},
    errors: {},
  });

  useEffect(() => {
    let es: EventSource;

    function connect() {
      es = new EventSource('/api/metrics/stream');

      es.onopen = () => { setConnected(true); };

      es.onmessage = (e: MessageEvent<string>) => {
        try {
          setMetrics(JSON.parse(e.data) as MetricsSnapshot);
        } catch { /* ignore malformed frames */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        retryRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es.close();
      if (retryRef.current !== null) clearTimeout(retryRef.current);
    };
  }, []);

  async function fireEvents() {
    setFiring(true);
    try {
      const events: MetricName[] = ['page_views', 'api_calls', 'events_processed'];
      await Promise.all(
        events.map((event) =>
          fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, count: Math.ceil(Math.random() * 10) }),
          })
        )
      );
    } finally {
      setFiring(false);
    }
  }

  async function simulateRegion() {
    setSyncing(true);
    try {
      const regionState = regionRef.current;
      // Advance each region's own counters monotonically, then gossip full state.
      for (const region of SIM_REGIONS) {
        for (const key of METRIC_KEYS) {
          const bump = Math.floor(Math.random() * 6);
          const current = regionState[key][region] ?? 0;
          regionState[key][region] = current + bump;
        }
      }
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: 'browser-sim', metrics: regionState }),
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.875rem', color: connected ? '#10b981' : '#94a3b8' }}>
          {connected ? '● Live' : '○ Connecting...'}
        </span>
        <button onClick={() => { void fireEvents(); }} disabled={firing} style={buttonStyle('#3b82f6', firing)}>
          {firing ? 'Firing...' : '⚡ Fire Events'}
        </button>
        <button onClick={() => { void simulateRegion(); }} disabled={syncing} style={buttonStyle('#8b5cf6', syncing)}>
          {syncing ? 'Syncing...' : '🌍 Simulate Region'}
        </button>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          Fire → local events · Simulate → merge 2 remote regions via POST /api/sync
        </span>
      </div>

      {metrics !== null ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          {(Object.entries(metrics) as Array<[MetricName, number]>).map(([key, count]) => (
            <div
              key={key}
              style={{
                padding: '1.5rem',
                borderRadius: '10px',
                border: `1px solid ${COLORS[key]}30`,
                background: `${COLORS[key]}08`,
              }}
            >
              <div style={{
                fontSize: '0.75rem',
                color: '#64748b',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.75rem',
              }}>
                {LABELS[key]}
              </div>
              <div style={{
                fontSize: '2.25rem',
                fontWeight: 700,
                color: COLORS[key],
                fontVariantNumeric: 'tabular-nums',
              }}>
                {count.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
          Waiting for first update...
        </div>
      )}
    </div>
  );
}
