/**
 * Event cover / OG image URL resolution (T-140).
 *
 * Event cards and the public event page's `og:image` fall back to a photo when
 * the event has no dedicated cover image (T-055). That fallback used the FIRST
 * photo's ORIGINAL storage path and signed it DIRECTLY — shipping a
 * `/storage/v1/object/sign/` URL to the full-resolution, payment-gated original
 * in the card payload / `<meta og:image>`, downloadable from devtools or an OG
 * scraper without paying. That is the same pre-bake leak T-131/T-133/T-136
 * closed on the cart + gallery surfaces, on two surfaces those tickets didn't
 * touch.
 *
 * Both helpers here route a first-photo cover that `needsProtectedPreview`
 * (watermarked OR for-sale) through the fail-closed `/api/watermark/` route,
 * which derives the treatment server-side (tiled watermark or clean medium
 * downscale) and never emits the full-res original. Only an event positively
 * known to be BOTH free (`price_per_photo` null) AND un-watermarked keeps the
 * direct signed original.
 *
 * A DEDICATED cover (T-055) is always direct-signed: it is a promotional
 * presentation image the photographer chose to show publicly, not a for-sale
 * photo (and it isn't a `photos` row, so the watermark route couldn't resolve a
 * policy for it anyway — it would fail closed to a tiled watermark on the
 * promo image).
 */

import { needsProtectedPreview } from '@/lib/preview-protection';
import { createSignedUrl } from './storage';
import type { SupabaseServerClient } from './types';

/** Default expiry for direct-signed cover URLs on event cards (1h). */
const COVER_SIGN_EXPIRY_SECONDS = 60 * 60;
/** Longer expiry for the OG image URL — it is embedded in cached page HTML. */
const OG_SIGN_EXPIRY_SECONDS = 60 * 60 * 24;

export interface EventCoverInput {
  eventId: string;
  /** Storage path (in the `photos` bucket) of the cover image. */
  coverPath: string;
  /**
   * True when `coverPath` is the dedicated cover image (T-055) rather than the
   * first-photo fallback. A dedicated cover is a promotional image → always
   * direct-signed; the protection predicate only applies to the first-photo
   * fallback (a real for-sale photo).
   */
  isDedicatedCover: boolean;
  watermarkEnabled: boolean | null;
  pricePerPhoto: number | null;
}

/**
 * Assemble the {@link EventCoverInput} list `signEventCoverUrls` consumes, from
 * a per-event cover-stats map, the set of events whose cover is the dedicated
 * image (T-055), and a per-event watermark/price policy lookup. The single
 * place the three public-card surfaces (talent explore, saved events,
 * photographer profile) build this wiring, so the leak-protection inputs can't
 * drift between them (T-140): a future change to what `needsProtectedPreview`
 * requires updates one helper, not three copy-pasted blocks.
 */
export function buildEventCoverInputs(
  stats: ReadonlyMap<string, { coverPath: string | null }>,
  dedicatedCovers: { has: (eventId: string) => boolean },
  policyById: ReadonlyMap<
    string,
    { watermark_enabled: boolean | null; price_per_photo: number | null }
  >,
): EventCoverInput[] {
  const inputs: EventCoverInput[] = [];
  for (const [eventId, info] of stats.entries()) {
    if (!info.coverPath) continue;
    const policy = policyById.get(eventId);
    inputs.push({
      eventId,
      coverPath: info.coverPath,
      isDedicatedCover: dedicatedCovers.has(eventId),
      watermarkEnabled: policy?.watermark_enabled ?? null,
      pricePerPhoto: policy?.price_per_photo ?? null,
    });
  }
  return inputs;
}

/**
 * Sign event-card cover URLs, keyed by event id. The single chokepoint the
 * three public-card surfaces (talent explore, saved events, photographer
 * profile) share, so the protection policy can't drift between them (T-140).
 *
 * A protected first-photo cover resolves to a ROOT-RELATIVE `/api/watermark/`
 * URL — matching the sibling `coverThumbUrl`'s `/api/thumb/` form and usable in
 * any client `next/image` src, without needing a request-derived base URL (the
 * card actions are `'use cache'`, where `headers()` is unavailable). Everything
 * unprotected is direct-signed.
 */
export async function signEventCoverUrls(
  supabase: SupabaseServerClient,
  covers: EventCoverInput[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    covers.map(async (cover) => {
      if (
        !cover.isDedicatedCover &&
        needsProtectedPreview({
          watermark_enabled: cover.watermarkEnabled,
          price_per_photo: cover.pricePerPhoto,
        })
      ) {
        out.set(cover.eventId, `/api/watermark/${cover.coverPath}`);
        return;
      }
      const signed = await createSignedUrl(
        supabase,
        'photos',
        cover.coverPath,
        COVER_SIGN_EXPIRY_SECONDS,
      );
      if (signed) out.set(cover.eventId, signed);
    }),
  );
  return out;
}

/**
 * Resolve the `og:image` URL for the public event page (T-140). Prefers the
 * dedicated cover (direct-signed, absolute); otherwise falls back to the first
 * photo, routing a protected one through the ABSOLUTE `/api/watermark/`
 * derivative (OG scrapers need a fully-qualified URL) instead of a direct
 * signed full-res original.
 */
export async function resolveEventOgImageUrl(
  supabase: SupabaseServerClient,
  opts: {
    eventId: string;
    coverPath: string | null;
    watermarkEnabled: boolean | null;
    pricePerPhoto: number | null;
    baseUrl: string;
  },
): Promise<string | null> {
  // Prefer the dedicated cover — the presentation image the photographer chose,
  // and social/SEO previews are exactly where it matters most.
  if (opts.coverPath) {
    return createSignedUrl(supabase, 'photos', opts.coverPath, OG_SIGN_EXPIRY_SECONDS);
  }

  // `photos` has no soft-delete column (only `events` does) — the original
  // metadata code filtered `.is('deleted_at', null)` on a non-existent column,
  // which PostgREST rejected, so this fallback silently returned null and the
  // first-photo OG image never rendered. Select the event's first APPROVED
  // photo directly: `upload_status='approved'` mirrors what the public gallery
  // shows, so a still-`pending` guest upload or a `rejected` photo can never
  // become the public social preview (event-level deletion is already handled
  // by the caller — the page only renders `generateMetadata` for an
  // accessible, non-deleted event).
  const { data: firstPhotoRow } = await supabase
    .from('photos')
    .select('original_url')
    .eq('event_id', opts.eventId)
    .eq('upload_status', 'approved')
    .not('original_url', 'is', null)
    .limit(1)
    .maybeSingle();
  const firstPhotoPath = (firstPhotoRow?.original_url as string | null | undefined) ?? null;
  if (!firstPhotoPath) return null;

  if (
    needsProtectedPreview({
      watermark_enabled: opts.watermarkEnabled,
      price_per_photo: opts.pricePerPhoto,
    })
  ) {
    return `${opts.baseUrl}/api/watermark/${firstPhotoPath}`;
  }
  return createSignedUrl(supabase, 'photos', firstPhotoPath, OG_SIGN_EXPIRY_SECONDS);
}
