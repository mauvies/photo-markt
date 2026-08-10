/**
 * The URL to share for an open photo: the CURRENT page, with `?photo=<id>` set.
 *
 * ⚠️ Never share the image URL. A photo's `url` is a watermark-route path or a
 * short-lived signed original — sharing it sends the recipient to bare image
 * bytes with no title, no price, no "Add to cart", and no way back into the
 * event. On a for-sale photo that is a lost sale, and it hands out a
 * purchase-flow-adjacent asset outside the purchase flow.
 *
 * Built by copying the current URL and setting the param rather than
 * assembling a path, so it carries whatever the current page needs to work for
 * the recipient — including the share code a private event keeps in its path
 * (`/events/<shareCode>`) and any other query param already present. The param
 * name matches `usePhotoLightboxUrl`'s, which is what makes the link open the
 * event page with that photo already selected.
 *
 * Returns null during SSR (there is no page to share yet), so callers no-op.
 */
export function buildPhotoShareUrl(photoId: string, paramName = 'photo'): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(paramName, photoId);
    return url.toString();
  } catch {
    return null;
  }
}
