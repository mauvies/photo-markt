import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Force-include the watermark tile PNG in the function bundle for the
  // `/api/watermark` route. Sharp reads it at runtime via fs.readFile.
  outputFileTracingIncludes: {
    '/api/watermark/**/*': ['./public/watermark/**/*'],
  },
  experimental: {
    serverActions: {
      // Per-file size is enforced in lib/photo-upload.ts (50 MB); this is the
      // aggregate request budget for bulk uploads (~10 photos at the per-file cap).
      bodySizeLimit: '500mb',
    },
    proxyClientMaxBodySize: '500mb',
    useCache: true,
    // Next 16's default Router Cache TTL for dynamic segments is 0 s, which
    // means back-navigation to any auth-coupled route re-fetches the RSC
    // payload and flashes loading.tsx. 30 s makes typical back-nav instant
    // while keeping data fresh enough that cart/photo mutations (which call
    // router.refresh / invalidateQueries) still reflect on revisit.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: (() => {
      const patterns: Array<{
        protocol: 'http' | 'https';
        hostname: string;
      }> = [];
      // Allow localhost and placeholder images for development only
      if (process.env.NODE_ENV === 'development') {
        patterns.push(
          {
            protocol: 'https',
            hostname: 'placehold.co',
          },
          {
            protocol: 'http',
            hostname: 'localhost',
          },
          {
            protocol: 'http',
            hostname: '127.0.0.1',
          },
        );
      }
      // Allow Supabase storage signed URLs
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (supabaseUrl) {
          const hostname = new URL(supabaseUrl).hostname;
          patterns.push({
            protocol: 'https',
            hostname,
          });
        }
      } catch {
        // ignore if env is missing or malformed
      }

      // Allow OAuth provider avatars (e.g. Google)
      patterns.push({
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      });
      return patterns;
    })(),
    // Disable image optimization for localhost URLs in development
    // Next.js blocks private IPs even when in remotePatterns, so we need to
    // use unoptimized prop on Image components for localhost URLs
    unoptimized: false,
    // Photo URLs are content-addressed by storage path — if a photo changes,
    // its path changes. So an optimized image can be reused as long as the
    // underlying signed URL stays valid. The 'use cache' wrapper regenerates
    // signed URLs every 55 min, so 24 h here just means fewer Sharp invocations
    // per photo across the day.
    minimumCacheTTL: 60 * 60 * 24,
  },
};

export default nextConfig;
