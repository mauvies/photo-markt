/**
 * Integration tests for cart Server Actions.
 *
 * Pattern (proof-of-concept for future Server Action tests):
 *   1. `vi.mock('@/database/server')` — replace the cookie-backed
 *      `createClient` with a service-role client. Cookies/Next.js render
 *      context aren't available outside of a real request, so we stub.
 *   2. `vi.mock('@/app/[lang]/actions/roles')` — `userHasRole` reads cookies
 *      too. Stub it against seeded `user_role_memberships` (capability).
 *   3. Seed test data via the shared helpers, then call the Server Action
 *      directly as a plain function.
 *   4. Assert DB side-effects via a fresh service-role client.
 *
 * Trade-off: this mocks more than an end-to-end approach (which would
 * spin up `next dev`), but it stays in-process and runs in ~100 ms.
 * Refactoring the actions to accept a client as a parameter would remove
 * the need for the `@/database/server` mock — worth doing if/when we want
 * to test the same flows under real cookie-based auth.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// Inline `vi.mock` declarations — Vitest only hoists them when they appear
// at the top level of the test file. See `test/helpers/server-action-mocks.ts`
// for the rationale and the canonical block to copy.

// Cart gating is by CAPABILITY now (does the user hold the TALENT role), not by
// the mutable `active_role`. Mirror the real `userHasRole` against the seeded
// `user_role_memberships` so tests reflect membership, not current view.
vi.mock('@/app/[lang]/actions/roles', () => ({
  userHasRole: vi.fn(async (slug: string) => {
    if (!mockSession.userId) return false;
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      'http://127.0.0.1:54321',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data } = await sb
      .from('user_role_memberships')
      .select('role')
      .eq('user_id', mockSession.userId);
    return (data ?? []).some((r: { role: string }) => r.role.toLowerCase() === slug);
  }),
}));

vi.mock('@/database/server', async () => {
  const { buildDatabaseServerMock } = await import('../../helpers/database-server-mock');
  const { mockSession } = await import('../../helpers/server-action-mocks');
  return buildDatabaseServerMock(mockSession);
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

import { revalidatePath } from 'next/cache';
import {
  addPhotoToCartAction,
  clearCartAction,
  getCartItemCountAction,
  mergeGuestCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { getOrCreateCart } from '@/database/queries/carts';
import type { GuestCartItem } from '@/lib/guest-cart';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Minimal guest-cart item — `mergeGuestCartAction` re-reads price/owner from
 * the DB, so only `photoId` actually drives the merge. */
function guestItem(photoId: string): GuestCartItem {
  return {
    photoId,
    photographerId: '00000000-0000-0000-0000-000000000000',
    eventId: '00000000-0000-0000-0000-000000000000',
    eventName: null,
    eventDate: null,
    unitPriceCents: 0,
    previewUrl: null,
  };
}

describe('cart Server Actions', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
  });

  describe('addPhotoToCartAction', () => {
    it("inserts the photo into the user's cart at the event price", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 7 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id);

      // Verify the cart_item landed with the right price (7.00 → 700 cents).
      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb
        .from('cart_items')
        .select('photo_id, photographer_id, unit_price_cents')
        .eq('cart_id', cart.id);
      expect(items).toHaveLength(1);
      expect(items?.[0]?.photo_id).toBe(photo.id);
      expect(items?.[0]?.photographer_id).toBe(photographer.id);
      expect(items?.[0]?.unit_price_cents).toBe(700);
    });

    it('rejects when the user is unauthenticated', async () => {
      mockSession.userId = null;
      await expect(addPhotoToCartAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /signed in/i,
      );
    });

    // Regression (fix-role-switch-stale-state): a talent-capable user must be
    // able to add to cart even while their active view is photographer — the
    // old code gated on `active_role`, which a background render could revert.
    it('allows a talent-capable user even while in photographer view', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 7 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      mockSession.activeRole = 'photographer'; // stale/irrelevant now

      await expect(addPhotoToCartAction(photo.id)).resolves.not.toThrow();

      const cart = await getOrCreateCart(createServiceClient(), talent.id);
      const { count } = await createServiceClient()
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(1);
    });

    it('rejects a user who does not hold the talent role', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = photographer.id;
      await expect(addPhotoToCartAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /talent users/i,
      );
    });

    it('rejects when the photo does not exist', async () => {
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await expect(addPhotoToCartAction('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /not found/i,
      );
    });

    it('stores 0 cents for a free event (price_per_photo = null)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: null });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb
        .from('cart_items')
        .select('unit_price_cents')
        .eq('cart_id', cart.id);
      expect(items?.[0]?.unit_price_cents).toBe(0);
    });

    it('rejects adding a photo whose event was soft-deleted (T-040)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await createServiceClient()
        .from('events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', event.id);

      await expect(addPhotoToCartAction(photo.id)).rejects.toThrow(/not found/i);

      const cart = await getOrCreateCart(createServiceClient(), talent.id);
      const { count } = await createServiceClient()
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(0);
    });

    // T-132: a private event (is_public = false) is reachable only via its
    // share code. Adding one of its photos by bare UUID — with no code — must be
    // rejected, or an authenticated user who merely learned the id could buy a
    // photo they were never given the share link to.
    it('rejects a private-event photo added with no share code (T-132)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIV132',
      });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await expect(addPhotoToCartAction(photo.id)).rejects.toThrow(/not found/i);

      const cart = await getOrCreateCart(createServiceClient(), talent.id);
      const { count } = await createServiceClient()
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(0);
    });

    it('rejects a private-event photo added with the wrong share code (T-132)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIV132',
      });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await expect(addPhotoToCartAction(photo.id, 'WRONGCODE')).rejects.toThrow(/not found/i);
    });

    it('adds a private-event photo when the correct share code is presented (T-132)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIV132',
      });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await expect(addPhotoToCartAction(photo.id, 'PRIV132')).resolves.not.toThrow();

      const cart = await getOrCreateCart(createServiceClient(), talent.id);
      const { count } = await createServiceClient()
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(1);
    });

    it('adds a public-event photo with no share code (T-132 — public flow unaffected)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5, is_public: true });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await expect(addPhotoToCartAction(photo.id)).resolves.not.toThrow();
      expect(await getCartItemCountAction()).toBe(1);
    });

    // T-132: the favorites path presents no share code — instead the server
    // proves access from the talent's own tag row (a photo they saved, so they
    // demonstrably reached the event). No bearer token is echoed through the
    // client.
    it('adds a private-event photo the talent has tagged, with no share code (T-132 favorites path)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIVTAG',
      });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      // The talent has this photo in their library (saved from the event).
      await createServiceClient()
        .from('talent_photo_tags')
        .insert({ photo_id: photo.id, talent_user_id: talent.id, tagged_by_user_id: talent.id });
      mockSession.userId = talent.id;

      await expect(addPhotoToCartAction(photo.id)).resolves.not.toThrow();
      expect(await getCartItemCountAction()).toBe(1);
    });
  });

  describe('removePhotoFromCartAction', () => {
    it('removes a previously-added photo from the cart', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id);
      expect(await getCartItemCountAction()).toBe(1);

      await removePhotoFromCartAction(photo.id);
      expect(await getCartItemCountAction()).toBe(0);
    });
  });

  describe('clearCartAction', () => {
    it('drops every cart_item for the current user', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const a = await createTestPhoto(event.id);
      const b = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(a.id);
      await addPhotoToCartAction(b.id);
      expect(await getCartItemCountAction()).toBe(2);

      await clearCartAction();
      expect(await getCartItemCountAction()).toBe(0);
    });
  });

  describe('getCartItemCountAction', () => {
    it('returns 0 for unauthenticated callers without throwing', async () => {
      mockSession.userId = null;
      expect(await getCartItemCountAction()).toBe(0);
    });

    it('returns 0 when the caller lacks the talent role (cart is talent-only)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = photographer.id;
      expect(await getCartItemCountAction()).toBe(0);
    });
  });

  // The post-login merge whose flash T-039 fixes: the data outcome must be the
  // union of the guest items and the pre-existing cart, with no duplicate rows.
  describe('mergeGuestCartAction', () => {
    it('unions guest items with the existing cart and never duplicates a photo', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photoA = await createTestPhoto(event.id);
      const photoB = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      // The authenticated cart already holds photoA before the merge.
      await addPhotoToCartAction(photoA.id);

      // Guest cart carries photoA (a duplicate) + photoB (new).
      const merged = await mergeGuestCartAction([guestItem(photoA.id), guestItem(photoB.id)]);
      expect(merged).toBeGreaterThan(0);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb.from('cart_items').select('photo_id').eq('cart_id', cart.id);
      const photoIds = (items ?? []).map((i) => i.photo_id).sort();
      // Exactly two rows: A is not duplicated, B is added.
      expect(photoIds).toEqual([photoA.id, photoB.id].sort());
      expect(await getCartItemCountAction()).toBe(2);
    });

    it('re-prices each merged item from the event, ignoring the guest payload', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 9 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      // Guest payload claims a bogus price; the action must use the DB price.
      await mergeGuestCartAction([{ ...guestItem(photo.id), unitPriceCents: 1 }]);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb
        .from('cart_items')
        .select('unit_price_cents, photographer_id')
        .eq('cart_id', cart.id);
      expect(items).toHaveLength(1);
      expect(items?.[0]?.unit_price_cents).toBe(900);
      expect(items?.[0]?.photographer_id).toBe(photographer.id);
    });

    it('returns 0 for an unauthenticated caller (no merge)', async () => {
      mockSession.userId = null;
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id);
      expect(await mergeGuestCartAction([guestItem(photo.id)])).toBe(0);
    });

    it('skips guest items whose event was soft-deleted (T-040)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const liveEvent = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const deadEvent = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const livePhoto = await createTestPhoto(liveEvent.id);
      const deadPhoto = await createTestPhoto(deadEvent.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await createServiceClient()
        .from('events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deadEvent.id);

      const merged = await mergeGuestCartAction([guestItem(livePhoto.id), guestItem(deadPhoto.id)]);
      expect(merged).toBe(1);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb.from('cart_items').select('photo_id').eq('cart_id', cart.id);
      expect((items ?? []).map((i) => i.photo_id)).toEqual([livePhoto.id]);
    });

    // T-132: merge is the bridge from the (client-controlled) guest cart into
    // the authenticated cart, which authed checkout then trusts. A private-event
    // item only crosses it when the cart carries that event's real share code —
    // the proof a legit guest stashed at add time. An item from a private event
    // the cart never proves is dropped. Access is keyed per event: event A's
    // code never unlocks event B (unlike a purchasability-only filter).
    it('drops a private-event item the cart never proves, keeps public + proven-private (T-132)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const publicEvent = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: true,
      });
      const privateA = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIV_A',
      });
      const privateB = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIV_B',
      });
      const publicPhoto = await createTestPhoto(publicEvent.id);
      const photoA = await createTestPhoto(privateA.id);
      const photoB = await createTestPhoto(privateB.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      // The cart proves only PRIV_A (photoA carries it). photoB (a different
      // private event) has no code anywhere in the cart → dropped.
      const merged = await mergeGuestCartAction([
        guestItem(publicPhoto.id),
        { ...guestItem(photoA.id), eventShareCode: 'PRIV_A' },
        guestItem(photoB.id),
      ]);
      expect(merged).toBe(2);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { data: items } = await sb.from('cart_items').select('photo_id').eq('cart_id', cart.id);
      const photoIds = (items ?? []).map((i) => i.photo_id).sort();
      expect(photoIds).toEqual([publicPhoto.id, photoA.id].sort());
    });

    // T-132: a code stashed on one item unlocks only its OWN private event's
    // items, but it does so for ALL of them — merge pools the cart's codes like
    // the guest preview/checkout do, so a sibling item from the same private
    // event isn't dropped just because its own snapshot predates the stored code.
    it('merges a code-less item when a sibling from the same private event carries the code (T-132)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const privateEvent = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIV_SHARED',
      });
      const withCode = await createTestPhoto(privateEvent.id);
      const codeless = await createTestPhoto(privateEvent.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      const merged = await mergeGuestCartAction([
        { ...guestItem(withCode.id), eventShareCode: 'PRIV_SHARED' },
        guestItem(codeless.id), // same event, no own code → still merged via the pooled code
      ]);
      expect(merged).toBe(2);
    });
  });

  // T-162: the add/remove/clear mutations must invalidate the cart route's
  // client Router Cache so the NEXT navigation to the cart refetches instead of
  // serving a stale prefetched RSC snapshot. Before the fix none of them called
  // `revalidatePath`, so photos added from the event view didn't appear on the
  // cart page until a manual F5. Mirrors the Stripe webhook's revalidation.
  describe('cart route revalidation (T-162)', () => {
    const CART_ROUTE = '/[lang]/dashboard/talent/cart';

    it('addPhotoToCartAction revalidates the cart route', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      vi.mocked(revalidatePath).mockClear();
      await addPhotoToCartAction(photo.id);

      expect(revalidatePath).toHaveBeenCalledWith(CART_ROUTE, 'page');
    });

    it('removePhotoFromCartAction revalidates the cart route', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      vi.mocked(revalidatePath).mockClear();
      await removePhotoFromCartAction(photo.id);

      expect(revalidatePath).toHaveBeenCalledWith(CART_ROUTE, 'page');
    });

    it('clearCartAction revalidates the cart route', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      vi.mocked(revalidatePath).mockClear();
      await clearCartAction();

      expect(revalidatePath).toHaveBeenCalledWith(CART_ROUTE, 'page');
    });
  });
});
