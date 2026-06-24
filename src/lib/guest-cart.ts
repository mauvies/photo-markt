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
