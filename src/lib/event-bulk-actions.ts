/** Which bulk actions the public event selection bar offers, given event/viewer state. */
export type EventBulkActionKey = 'add-to-cart' | 'download' | 'delete';

/**
 * Decide which bulk actions appear in the public event gallery's selection bar.
 *
 * Download is offered only on free events: paid events serve watermarked
 * previews, so a bulk download of selected (unpurchased) photos would just zip
 * up unusable, marked images. Per-photo download of *purchased* originals stays
 * available elsewhere (the lightbox / talent dashboard) — that path is gated by
 * purchase, not by this list. See ticket T-010.
 */
export function eventBulkActionKeys(opts: {
  canAddToCart: boolean;
  isFreeEvent: boolean;
  canDeleteOwnPhotos: boolean;
}): EventBulkActionKey[] {
  const keys: EventBulkActionKey[] = [];
  if (opts.canAddToCart) keys.push('add-to-cart');
  if (opts.isFreeEvent) keys.push('download');
  if (opts.canDeleteOwnPhotos) keys.push('delete');
  return keys;
}
