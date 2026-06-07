import 'server-only';
// Next.js 15.0–15.2: unstable_cacheLife; becomes stable cacheLife in 15.3+
import { unstable_cacheLife as cacheLife } from 'next/cache';

// Cache Components: 'use cache' moves caching decisions to the function level.
// cacheLife fine-tunes stale/revalidate/expire windows using named profiles
// defined in next.config.ts under `cacheLife`. Requires experimental.useCache: true.

const METRICS_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// Re-validates every 2 minutes; stale for 1 minute (matches 'minutes' profile)
export async function fetchHighPerformanceData(params: string): Promise<unknown> {
  'use cache';
  cacheLife('minutes');

  if (!METRICS_BASE_URL) {
    return { stub: true, params, note: 'set NEXT_PUBLIC_API_BASE_URL in .env.local to use a live endpoint' };
  }

  const response = await fetch(
    `${METRICS_BASE_URL}/metrics?id=${encodeURIComponent(params)}`,
  );
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

// Catalog data — static for weeks, minimal CDN churn
export async function fetchStaticCatalog(): Promise<{ version: string; items: string[] }> {
  'use cache';
  cacheLife('weeks');

  return { version: '1.0', items: ['alpha', 'beta', 'gamma'] };
}

// Per-user data — short revalidation window
export async function fetchUserPreferences(
  _userId: string,
): Promise<{ theme: string; locale: string }> {
  'use cache';
  cacheLife('minutes');
  // cacheTag(`user:${_userId}`) — then revalidateTag(`user:${_userId}`) on update

  return { theme: 'system', locale: 'en-US' };
}
