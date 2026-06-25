/** Which bulk actions the public event selection bar offers, given event/viewer state. */
export type EventBulkActionKey = 'add-to-cart' | 'download' | 'delete';

/**
 * Whether the bulk "Download" action should appear in an event gallery's
 * selection bar. Free events let anyone zip the selection; paid (watermarked)
 * events only when the viewer actually has purchased photos to download —
 * otherwise it's a dead button that just zips unusable marked previews (or
 * errors with "nothing purchased"). All three event viewers (public, talent,
 * photographer) must decide this the same way so the button can't drift back
 * out of sync. See tickets T-010 and T-041.
 */
export function shouldShowBulkDownload(isFreeEvent: boolean, hasPurchasedPhotos: boolean): boolean {
  return isFreeEvent || hasPurchasedPhotos;
}

/**
 * Decide which bulk actions appear in the public event gallery's selection bar.
 * Per-photo download of *purchased* originals stays available elsewhere (the
 * lightbox), gated by purchase, not by this list.
 */
export function eventBulkActionKeys(opts: {
  canAddToCart: boolean;
  isFreeEvent: boolean;
  hasPurchasedPhotos: boolean;
  canDeleteOwnPhotos: boolean;
}): EventBulkActionKey[] {
  const keys: EventBulkActionKey[] = [];
  if (opts.canAddToCart) keys.push('add-to-cart');
  if (shouldShowBulkDownload(opts.isFreeEvent, opts.hasPurchasedPhotos)) keys.push('download');
  if (opts.canDeleteOwnPhotos) keys.push('delete');
  return keys;
}
