import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Partial Prerendering: static shell from CDN + streaming dynamic segments
    ppr: true,
    // dynamicIO enforces explicit caching boundaries
    dynamicIO: true,
    // Named cacheLife profiles referenced by lib/server/cache.ts
    // @ts-expect-error cacheLife under experimental is typed in Next.js ≥ 15.3
    cacheLife: {
      minutes: { stale: 60,     revalidate: 120,     expire: 3600    },
      hours:   { stale: 3600,   revalidate: 7200,    expire: 86400   },
      weeks:   { stale: 604800, revalidate: 1209600, expire: 2592000 },
    },
  },
  // standalone bundles only what's needed; pair with --max-old-space-size flag
  output: 'standalone',
};

export default nextConfig;
