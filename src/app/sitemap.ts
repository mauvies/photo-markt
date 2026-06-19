import type { MetadataRoute } from 'next';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getSiteUrl } from '@/lib/get-site-url';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  // Fetch all active public events — use slug when available, fall back to UUID
  const { data: events } = await supabaseAdmin
    .from('events')
    .select('id, slug, updated_at')
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  const eventUrls: MetadataRoute.Sitemap = (events ?? []).map((event) => ({
    url: `${siteUrl}/events/${event.slug ?? event.id}`,
    lastModified: event.updated_at ? new Date(event.updated_at) : new Date(),
    // Events may add new photos daily after the shoot
    changeFrequency: 'daily' as const,
    priority: 0.9,
  }));

  return [
    // Static pages
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${siteUrl}/events`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${siteUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    // Dynamic event pages
    ...eventUrls,
  ];
}
