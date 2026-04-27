export interface GuestCartItem {
  photoId: string;
  photographerId: string;
  eventId: string;
  eventName: string | null;
  eventDate: string | null;
  unitPriceCents: number;
  previewUrl: string | null;
}

export const GUEST_CART_KEY = 'photo-markt_guest_cart';
export const LEGACY_GUEST_CART_KEY = 'picdemi_guest_cart';
