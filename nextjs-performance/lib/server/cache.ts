import 'server-only';
import { cacheLife } from 'next/cache';

// Cache Components: 'use cache' moves caching decisions into the function,
// not into route-level config. cacheLife maps to named profiles in next.config.ts.

// Re-validates every 2 minutes; stale for 1 minute
export async function fetchHighPerformanceData(params: string): Promise<unknown> {
  'use cache';
  cacheLife('minutes');

  const response = await fetch(
    `https://api.example.com/metrics?id=${encodeURIComponent(params)}`,
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

// Per-user data — short revalidation, tagged for targeted purges
export async function fetchUserPreferences(
  userId: string,
): Promise<{ theme: string; locale: string }> {
  'use cache';
  cacheLife('minutes');

  // In production: cacheTag(`user:${userId}`) then revalidateTag(`user:${userId}`) on update
  return { theme: 'system', locale: 'en-US' };
}
