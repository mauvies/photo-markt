import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Force-include font assets in the bundle for routes that read them at
  // runtime via fs. The watermark API needs Inter-Bold.woff to render text
  // (Vercel/Lambda has no fontconfig, so we ship the font ourselves and
  // convert glyphs to SVG paths via opentype.js).
  outputFileTracingIncludes: {
    '/api/watermark/**/*': ['./lib/fonts/**/*'],
  },
  experimental: {
    serverActions: {
      // Per-file size is enforced in lib/photo-upload.ts (50 MB); this is the
      // aggregate request budget for bulk uploads (~10 photos at the per-file cap).
      bodySizeLimit: '500mb',
    },
    proxyClientMaxBodySize: '500mb',
    useCache: true,
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
  },
};

export default nextConfig;
