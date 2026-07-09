import { revalidateTag } from 'next/cache';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

export type EventDetailTagIdentity = {
  id: string;
  slug: string | null;
  share_code: string | null;
};

/**
 * Revalidates the event-detail cache tag for every param a viewer might
 * have used to reach the event (UUID, slug, or share_code). Without this,
 * photo content changes only invalidate the UUID-keyed cache, so visitors
 * arriving via slug or share_code keep seeing stale photos until the TTL
 * elapses.
 */
export function revalidateEventDetailTags(event: EventDetailTagIdentity): void {
  revalidateTag(`event-${event.id}`, 'max');
  if (event.slug) revalidateTag(`event-${event.slug}`, 'max');
  if (event.share_code) revalidateTag(`event-${event.share_code}`, 'max');
}

/** Revalidates the owner's own dashboard listing tags (event list + stats). */
export function revalidateOwnerListingTags(ownerId: string): void {
  revalidateTag(`photographer-events-${ownerId}`, 'max');
  revalidateTag(`dashboard-photographer-${ownerId}`, 'max');
}

/**
 * Revalidates the owner's dashboard listing tags AND the PUBLIC listing
 * tags an event's approved-photo count feeds: home "Featured" (`top-events`),
 * talent search/explore (`events-public`), and the photographer's public
 * profile (`photographer-${slug}`). Always unconditional.
 *
 * An earlier version tried to only bust the public tags when an event's
 * approved-photo count crossed the `>= 1` visibility boundary, to spare the
 * high-traffic public caches from a bust-per-photo on a large batch. That
 * raced under the per-photo Inngest worker's own concurrency (up to 5
 * photos of the same event promoted concurrently): several invocations
 * could each read a post-promotion count > 1 and skip the bust entirely,
 * silently reintroducing the exact staleness bug this module exists to fix.
 * `revalidateTag` just marks a tag stale — it doesn't redo work — so
 * unconditional busting here is the safe default.
 */
export async function revalidateEventListingTags(ownerId: string): Promise<void> {
  revalidateOwnerListingTags(ownerId);
  revalidateTag('events-public', 'max');
  revalidateTag('top-events', 'max');
  const { data: profile, error } = await adminClient
    .from('profiles')
    .select('slug')
    .eq('id', ownerId)
    .maybeSingle();
  if (error) {
    console.error('[revalidateEventListingTags] profile slug lookup failed', error);
    return;
  }
  if (profile?.slug) revalidateTag(`photographer-${profile.slug}`, 'max');
}
