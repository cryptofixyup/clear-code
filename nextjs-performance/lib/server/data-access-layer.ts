import 'server-only';
import { assertMetricQuery } from '@/lib/validation';

// server-only import prevents this module from being bundled into the client.
// Any accidental client import will throw at build time.

type DbRow = {
  id: string;
  value: number;
  timestamp: string;
  // These fields exist on the DB row but are intentionally excluded from the
  // RSC payload — they would add ~15KB of redundant JSON per request shell.
  metadata: Record<string, unknown>;
  internalFlags: number;
  ownerId: string;
  auditLog: string[];
};

export type MetricRow = Pick<DbRow, 'id' | 'value' | 'timestamp'>;

// Simulated DB client — replace with your actual driver (e.g. @vercel/postgres, Drizzle)
const db = {
  async query(_sql: string, _params: unknown[]): Promise<DbRow[]> {
    return [
      {
        id: 'a1b2c3',
        value: 42,
        timestamp: new Date().toISOString(),
        metadata: { region: 'us-east-1', source: 'cdn' },
        internalFlags: 0b1010,
        ownerId: 'system',
        auditLog: ['created', 'updated'],
      },
    ];
  },
};

// Data Access Layer: validates input, queries DB, then PRUNES the payload.
// Only the three fields the client component actually renders cross the wire.
// This is the primary defense against RSC 'double data' serialization bloat.
export async function getMetricsForUser(
  userId: string,
  query: unknown,
): Promise<MetricRow[]> {
  const parsed = assertMetricQuery(query);

  const rows = await db.query(
    'SELECT id, value, timestamp, metadata, internal_flags, owner_id, audit_log FROM metrics WHERE user_id = ? AND metric = ? LIMIT ?',
    [userId, parsed.metric, parsed.limit ?? 100],
  );

  // Explicit destructure ensures no extra fields slip through
  return rows.map(({ id, value, timestamp }) => ({ id, value, timestamp }));
}
