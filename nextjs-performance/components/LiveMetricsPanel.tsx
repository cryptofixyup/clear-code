'use client';

import { useEffect, useRef, useState } from 'react';

type MetricName = 'page_views' | 'api_calls' | 'events_processed' | 'errors';
type MetricsSnapshot = Record<MetricName, number>;

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

export default function LiveMetricsPanel() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [firing, setFiring] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '0.875rem', color: connected ? '#10b981' : '#94a3b8' }}>
          {connected ? '● Live' : '○ Connecting...'}
        </span>
        <button
          onClick={() => { void fireEvents(); }}
          disabled={firing}
          style={{
            padding: '0.4rem 1rem',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: firing ? 'not-allowed' : 'pointer',
            opacity: firing ? 0.6 : 1,
            fontSize: '0.8rem',
            fontWeight: 500,
          }}
        >
          {firing ? 'Firing...' : '⚡ Fire Events'}
        </button>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          Increments CRDT counters via POST /api/events
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
