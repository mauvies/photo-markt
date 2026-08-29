export interface GuestCartItem {
  photoId: string;
  photographerId: string;
  eventId: string;
  eventName: string | null;
  eventDate: string | null;
  /**
   * Public event share code → `/events/[shareCode]` link in the guest cart.
   * Optional: items cached in localStorage before this field existed won't
   * have it, so the event name renders as plain text for those.
   */
  eventShareCode?: string | null;
  unitPriceCents: number;
  previewUrl: string | null;
}

export const GUEST_CART_KEY = 'photo-markt_guest_cart';

function isGuestCartItem(value: unknown): value is GuestCartItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.photoId === 'string' && typeof item.unitPriceCents === 'number';
}

/**
 * Parse the guest cart out of a raw localStorage string.
 *
 * Shared by the provider's mount hydration and its cross-tab `storage`
 * listener (T-223) so both agree on what a stored cart is. Fails closed to an
 * empty cart: the value is user-writable and survives deploys, so a malformed
 * or half-written payload must not reach `items` — an entry without a numeric
 * `unitPriceCents` would poison `subtotalCents` with `NaN`, and a non-array
 * payload would break every consumer that maps over it.
 */
export function parseGuestCart(raw: string | null): GuestCartItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGuestCartItem);
  } catch {
    return [];
  }
}
