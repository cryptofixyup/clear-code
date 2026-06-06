import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Partial Prerendering: static shell from CDN + streaming dynamic segments
    ppr: true,
    // dynamicIO enforces explicit caching boundaries
    dynamicIO: true,
    // useCache enables the 'use cache' React directive (required in Next.js 15.0–15.2)
    useCache: true,
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
  webpack(config) {
    // Typia's ts-patch transform covers tsc; this plugin covers the webpack
    // bundle emitted by Next.js so typia.createAssert<T>() calls are replaced
    // at build time rather than throwing at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TypiaPlugin = require('typia/lib/WebpackPlugin');
    config.plugins.push(new (TypiaPlugin.default ?? TypiaPlugin)());
    return config;
  },
};

export default nextConfig;
