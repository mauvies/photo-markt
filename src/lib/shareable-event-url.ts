/**
 * The minimal event shape needed to resolve a shareable link. Kept structural
 * so both server rows (`getEvent`) and lighter projections satisfy it.
 */
export type ShareableEvent = {
  id: string;
  is_public: boolean;
  slug: string | null;
  share_code: string | null;
};

/**
 * Resolve the locale-prefixed public path a recipient opens to reach an event.
 *
 * The public route (`[lang]/events/[shareCode]/page.tsx`) resolves a UUID or
 * slug **only when `is_public = true`**; a private event resolves **only** via
 * its share code. So:
 * - Public  → `/{locale}/events/{slug ?? id}`
 * - Private → `/{locale}/events/{share_code}` — the share code is the access
 *   key; a link without it silently fails for the recipient (T-179).
 *
 * The private fallback to `id` only bites a degenerate private event with no
 * share code (never produced by event creation); such a link can't grant
 * access, but there is no better segment to offer.
 *
 * Returns a path (no origin) so the same value works in any environment; the
 * caller prepends the request/site origin to form the absolute URL.
 */
export function getShareableEventPath(event: ShareableEvent, locale: string): string {
  const segment = event.is_public ? (event.slug ?? event.id) : (event.share_code ?? event.id);
  return `/${locale}/events/${segment}`;
}
