/**
 * Shared "does this photo's preview need pre-bake protection?" predicate
 * (T-131 / T-133 / T-136).
 *
 * While a photo's thumbnail hasn't baked, callers fall back to a URL built
 * from the ORIGINAL storage path. That fallback must never expose more than
 * the steady state (the public medium thumb) does — "full resolution only
 * accessible after purchase" — so anything with something to protect is
 * routed through the fail-closed `/api/watermark/` route, which picks the
 * treatment server-side from the event's own policy (tiled watermark for
 * `watermark_enabled` events, clean medium-budget downscale for events that
 * sell without a visible mark).
 *
 * There is something to protect when the event is watermarked (T-131) OR
 * for-sale (T-133). For-sale means any non-null `price_per_photo` — INCLUDING
 * 0, matching `isForSale` and both download gates, which all key on
 * `price_per_photo !== null`. Only an event positively known to be BOTH free
 * (`price_per_photo` null) AND un-watermarked has nothing a "purchase" would
 * grant, so only it may keep the direct signed original. Anything we can't
 * positively confirm (a null/RLS-hidden event embed, an `event_id` NULL
 * orphan, an unknown watermark flag or price) fails closed to protected —
 * which is why both fields are REQUIRED in the parameter type: a caller whose
 * query never selected one of them must widen its select, not silently pass
 * `undefined` and fail open.
 *
 * Every pre-bake signing site — the cart resolver (`getPhotoPreviewUrls`)
 * and the gallery surfaces (public event page + load-more, talent event
 * view, talent dashboard, favorites) — must derive its decision from this
 * predicate rather than re-deriving "is it watermarked?" locally.
 */
export function needsProtectedPreview(
  event:
    | { watermark_enabled: boolean | null | undefined; price_per_photo: number | null | undefined }
    | null
    | undefined,
): boolean {
  if (!event) return true;
  // Unprotected ONLY when positively confirmed free AND un-watermarked;
  // undefined (field never selected) fails closed on both sides.
  return !(event.watermark_enabled === false && event.price_per_photo === null);
}
