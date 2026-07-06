/**
 * Derive the primary CTA for the two-panel photo-detail modal from the same
 * action flags the event viewers already compute for the lightbox — no new
 * rules, no hardcoded decisions.
 *
 * The modal only opens on paid events, so the effective cases are:
 *   - the photo is owned/downloadable → Download wins
 *   - it's already in the cart → show the in-cart (remove) state
 *   - otherwise it can be added to the cart
 *   - nothing actionable → unavailable (defensive; shouldn't occur on a paid surface)
 */
export type PhotoCtaKind = 'download' | 'in-cart' | 'add-to-cart' | 'unavailable';

export interface PhotoCtaInput {
  /** The surface offers a cart (viewer's `showAddToCart`). */
  showAddToCart: boolean;
  /** The surface offers downloads (viewer's `showDownload`). */
  showDownload: boolean;
  /** Per-photo download gate (`canDownloadPhoto`). On a paid event this is true
   * only for photos the viewer owns/purchased. */
  isDownloadable: boolean;
  /** The current photo is already in the cart. */
  isInCart: boolean;
}

export function resolvePhotoCta(input: PhotoCtaInput): PhotoCtaKind {
  if (input.showDownload && input.isDownloadable) return 'download';
  if (input.showAddToCart && input.isInCart) return 'in-cart';
  if (input.showAddToCart) return 'add-to-cart';
  return 'unavailable';
}
