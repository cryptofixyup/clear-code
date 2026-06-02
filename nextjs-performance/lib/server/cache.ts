import 'server-only';

// Cache Components: 'use cache' moves caching decisions to the function level.
// cacheLife fine-tunes stale/revalidate/expire windows using named profiles
// defined in next.config.ts under `cacheLife`.
//
// Import note: Next.js 15.2.x ships cacheLife as `unstable_cacheLife`;
// it becomes the stable `cacheLife` export in 15.3+.
// Uncomment the appropriate line for your Next.js version:
//
//   import { cacheLife } from 'next/cache';           // Next.js ≥ 15.3
//   import { unstable_cacheLife as cacheLife } from 'next/cache'; // 15.0–15.2

// Re-validates every 2 minutes; stale for 1 minute (matches 'minutes' profile)
export async function fetchHighPerformanceData(params: string): Promise<unknown> {
  'use cache';
  // cacheLife('minutes'); — add this once cacheLife is imported above

  const response = await fetch(
    `https://api.example.com/metrics?id=${encodeURIComponent(params)}`,
  );
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

// Catalog data — static for weeks, minimal CDN churn
export async function fetchStaticCatalog(): Promise<{ version: string; items: string[] }> {
  'use cache';
  // cacheLife('weeks');

  return { version: '1.0', items: ['alpha', 'beta', 'gamma'] };
}

// Per-user data — short revalidation window
export async function fetchUserPreferences(
  _userId: string,
): Promise<{ theme: string; locale: string }> {
  'use cache';
  // cacheLife('minutes');
  // cacheTag(`user:${_userId}`) — then revalidateTag(`user:${_userId}`) on update

  return { theme: 'system', locale: 'en-US' };
}
