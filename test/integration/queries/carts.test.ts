/**
 * Integration tests for `database/queries/carts.ts`.
 *
 * The cart layer is the most-touched user-facing data flow (every Add To
 * Cart, every checkout). These tests cover the public surface: idempotent
 * inserts, count helpers, isPhotoInCart, and the get-or-create life cycle.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPhotoToCart,
  clearCart,
  getCart,
  getCartItemCount,
  getCartItemsWithDetails,
  getOrCreateCart,
  isPhotoInCart,
  removePhotoFromCart,
} from '@/database/queries/carts';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/**
 * Create the bundle most cart tests need: photographer + event + photo +
 * talent user. Returns the four ids in one call so each test stays terse.
 */
async function setupCartFixtures() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id);
  const photo = await createTestPhoto(event.id);
  const talent = await createTestUser('TALENT');
  return { photographer, event, photo, talent };
}

describe('database/queries/carts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getOrCreateCart', () => {
    it('creates a cart when none exists for the user', async () => {
      const talent = await createTestUser('TALENT');
      const cart = await getOrCreateCart(createServiceClient(), talent.id);
      expect(cart.id).toBeDefined();
      expect(cart.user_id).toBe(talent.id);
    });

    it('returns the existing cart on subsequent calls (no duplicates)', async () => {
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const first = await getOrCreateCart(sb, talent.id);
      const second = await getOrCreateCart(sb, talent.id);
      expect(second.id).toBe(first.id);
    });
  });

  describe('getCart', () => {
    it('returns the cart when caller is the owner', async () => {
      const talent = await createTestUser('TALENT');
      const cart = await getOrCreateCart(createServiceClient(), talent.id);
      const found = await getCart(createServiceClient(), cart.id, talent.id);
      expect(found?.id).toBe(cart.id);
    });

    it('returns null when caller is not the cart owner', async () => {
      const owner = await createTestUser('TALENT');
      const stranger = await createTestUser('TALENT');
      const cart = await getOrCreateCart(createServiceClient(), owner.id);
      const found = await getCart(createServiceClient(), cart.id, stranger.id);
      expect(found).toBeNull();
    });
  });

  describe('addPhotoToCart / isPhotoInCart / getCartItemCount', () => {
    it('adds a photo and is visible via isPhotoInCart and the count', async () => {
      const { photo, talent } = await setupCartFixtures();
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      await addPhotoToCart(sb, cart.id, photo.id, /* photographer */ talent.id, 500);

      expect(await isPhotoInCart(sb, talent.id, photo.id)).toBe(true);
      expect(await getCartItemCount(sb, talent.id)).toBe(1);
    });

    it('is idempotent — adding the same photo twice yields one row', async () => {
      const { photo, photographer, talent } = await setupCartFixtures();
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      await addPhotoToCart(sb, cart.id, photo.id, photographer.id, 500);
      await addPhotoToCart(sb, cart.id, photo.id, photographer.id, 500);

      expect(await getCartItemCount(sb, talent.id)).toBe(1);
    });

    it('returns 0 for a user with no cart at all', async () => {
      const talent = await createTestUser('TALENT');
      expect(await getCartItemCount(createServiceClient(), talent.id)).toBe(0);
    });

    // T-117: the badge must agree with the same purchasability rule
    // (getPurchasablePhotoIds) the cart page self-heals against — otherwise
    // the header count and the cart page count can visibly disagree.
    it('excludes a cart item whose photo is no longer approved', async () => {
      const { photo, photographer, talent } = await setupCartFixtures();
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      await addPhotoToCart(sb, cart.id, photo.id, photographer.id, 500);
      await sb.from('photos').update({ upload_status: 'rejected' }).eq('id', photo.id);

      expect(await getCartItemCount(sb, talent.id)).toBe(0);
    });
  });

  describe('removePhotoFromCart', () => {
    it('drops the matching cart_item but leaves others alone', async () => {
      const { photographer, event, talent } = await setupCartFixtures();
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const photoA = await createTestPhoto(event.id);
      const photoB = await createTestPhoto(event.id);
      await addPhotoToCart(sb, cart.id, photoA.id, photographer.id, 500);
      await addPhotoToCart(sb, cart.id, photoB.id, photographer.id, 500);

      await removePhotoFromCart(sb, cart.id, photoA.id);

      expect(await isPhotoInCart(sb, talent.id, photoA.id)).toBe(false);
      expect(await isPhotoInCart(sb, talent.id, photoB.id)).toBe(true);
      expect(await getCartItemCount(sb, talent.id)).toBe(1);
    });

    it('is a no-op when the photo is not in the cart', async () => {
      const { photo, talent } = await setupCartFixtures();
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      // No insert — just attempt to remove.
      await expect(removePhotoFromCart(sb, cart.id, photo.id)).resolves.not.toThrow();
    });
  });

  describe('getCartItemsWithDetails', () => {
    it('returns the event share_code and photographer slug that drive the item links (T-038)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER', { display_name: 'Jane Lens' });
      const event = await createTestEvent(photographer.id, {
        name: 'Spring Race',
        share_code: 'SHARE123',
      });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      await addPhotoToCart(sb, cart.id, photo.id, photographer.id, 500);

      const items = await getCartItemsWithDetails(sb, cart.id, talent.id);

      expect(items).toHaveLength(1);
      const item = items[0];
      expect(item.event_name).toBe('Spring Race');
      expect(item.event_share_code).toBe('SHARE123');
      // The photographer link is keyed off username (the /photographer/[slug]
      // route resolves slug.eq OR username.eq; username is always present).
      expect(item.photographer_slug).toBe(photographer.username);
      expect(item.photographer_name).toBe('Jane Lens');
    });

    it('only returns items for the requested cart', async () => {
      const { photographer, event, talent } = await setupCartFixtures();
      const other = await createTestUser('TALENT');
      const sb = createServiceClient();
      const myCart = await getOrCreateCart(sb, talent.id);
      const theirCart = await getOrCreateCart(sb, other.id);
      const photo = await createTestPhoto(event.id);
      await addPhotoToCart(sb, theirCart.id, photo.id, photographer.id, 500);

      const mine = await getCartItemsWithDetails(sb, myCart.id, talent.id);
      expect(mine).toHaveLength(0);
    });

    it('excludes items whose event was soft-deleted, and keeps the count consistent (T-040)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const liveEvent = await createTestEvent(photographer.id, { name: 'Live' });
      const deadEvent = await createTestEvent(photographer.id, { name: 'Dead' });
      const livePhoto = await createTestPhoto(liveEvent.id);
      const deadPhoto = await createTestPhoto(deadEvent.id);
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      await addPhotoToCart(sb, cart.id, livePhoto.id, photographer.id, 500);
      await addPhotoToCart(sb, cart.id, deadPhoto.id, photographer.id, 500);

      // Soft-delete the second event after its photo is already in the cart.
      await sb
        .from('events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deadEvent.id);

      const items = await getCartItemsWithDetails(sb, cart.id, talent.id);
      expect(items.map((i) => i.photo_id)).toEqual([livePhoto.id]);
      // The badge count must match the rendered cart (only the live item).
      expect(await getCartItemCount(sb, talent.id)).toBe(1);
    });
  });

  describe('clearCart', () => {
    it('removes every cart_item for the given cart', async () => {
      const { photographer, event, talent } = await setupCartFixtures();
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const a = await createTestPhoto(event.id);
      const b = await createTestPhoto(event.id);
      await addPhotoToCart(sb, cart.id, a.id, photographer.id, 500);
      await addPhotoToCart(sb, cart.id, b.id, photographer.id, 500);

      await clearCart(sb, cart.id);

      expect(await getCartItemCount(sb, talent.id)).toBe(0);
    });

    it("doesn't touch other users' carts", async () => {
      const { photographer, event, talent } = await setupCartFixtures();
      const otherTalent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const myCart = await getOrCreateCart(sb, talent.id);
      const theirCart = await getOrCreateCart(sb, otherTalent.id);
      const photo = await createTestPhoto(event.id);
      await addPhotoToCart(sb, myCart.id, photo.id, photographer.id, 500);
      await addPhotoToCart(sb, theirCart.id, photo.id, photographer.id, 500);

      await clearCart(sb, myCart.id);

      expect(await getCartItemCount(sb, talent.id)).toBe(0);
      expect(await getCartItemCount(sb, otherTalent.id)).toBe(1);
    });
  });
});
