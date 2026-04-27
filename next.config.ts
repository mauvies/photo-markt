import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    proxyClientMaxBodySize: '500mb',
    useCache: true,
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
