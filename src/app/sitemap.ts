import type { MetadataRoute } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { supabaseAdmin } from '@/database/supabase-admin';
import { getSiteUrl } from '@/lib/get-site-url';

/** Minimal event shape the sitemap needs. */
export type SitemapEvent = {
  id: string;
  slug: string | null;
  updated_at: string | null;
};

/**
 * Public, non-deleted events for the sitemap.
 *
 * Cached and tagged `events-public` so crawler traffic no longer scans the whole
 * `events` table on every request — the same tag every event mutation already
 * revalidates, so creating or deleting a public event refreshes the sitemap
 * before the hourly TTL (F-04, caching audit T-083).
 */
async function getCachedSitemapEvents(): Promise<SitemapEvent[]> {
  'use cache';
  cacheTag('events-public');
  cacheLife('hours');

  const { data } = await supabaseAdmin
    .from('events')
    .select('id, slug, updated_at')
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  return data ?? [];
}

/**
 * Build the sitemap entries from the site URL and the (cached) public events.
 * Pure — no I/O — so the exact content is characterized in unit tests.
 */
export function buildSitemapEntries(
  siteUrl: string,
  events: SitemapEvent[],
): MetadataRoute.Sitemap {
  const eventUrls: MetadataRoute.Sitemap = events.map((event) => ({
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
    // NOTE: `/events` is intentionally NOT listed. It's an alias of the home
    // that carries `rel=canonical` → the home (T-157), so it's a non-canonical
    // URL and must not be submitted in the sitemap. The per-event detail pages
    // below (`/events/<slug>`) are the real indexed events surface.
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await getCachedSitemapEvents();
  return buildSitemapEntries(getSiteUrl(), events);
}
