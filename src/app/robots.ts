import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/get-site-url';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/events', '/events/*', '/pricing'],
        disallow: ['/dashboard/', '/auth/', '/api/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
