import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Partial Prerendering: static shell from CDN + streaming dynamic segments
    ppr: true,
    // dynamicIO enforces explicit caching boundaries — no implicit static/dynamic blending
    dynamicIO: true,
  },
  // standalone bundles only what's needed; pair with --max-old-space-size flag
  output: 'standalone',
  cacheLife: {
    minutes: { stale: 60, revalidate: 120, expire: 3600 },
    hours:   { stale: 3600, revalidate: 7200, expire: 86400 },
    weeks:   { stale: 604800, revalidate: 1209600, expire: 2592000 },
  },
};

export default nextConfig;
