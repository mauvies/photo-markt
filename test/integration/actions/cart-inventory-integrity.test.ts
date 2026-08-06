/**
 * Integration tests for T-117 (remove-orphaned-cart-items OpenSpec change):
 * cart inventory integrity across the authenticated cart, the guest cart, and
 * both checkout paths.
 *
 * (a) Deleting a photo/event empties `cart_items` for OTHER users — proven
 *     here to be the existing `on delete cascade` FK, not new app code.
 * (b) The authenticated cart self-heals (deletes) `cart_items` rows whose
 *     photo has gone unpurchasable via a path the FK doesn't cover (event
 *     soft-delete, `upload_status` regression) and reports a removed count.
 * (c) The guest cart's `loadGuestCartStateAction` strips the same cases from
 *     a client-held id list.
 * (d) Both checkout actions reject — never charge — when the cart contains
 *     an unpurchasable item.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

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

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
}));

// `revalidatePath` (added to the cart mutations in T-162) throws outside a Next
// request scope, so stub `next/cache` for these direct action calls.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

const createSessionMock = vi.fn(async (..._args: unknown[]) => ({
  url: 'https://checkout.stripe.test/session/cs_test_123',
}));
vi.mock('@/lib/stripe/config', () => ({
  stripe: {
    checkout: { sessions: { create: (...args: unknown[]) => createSessionMock(...args) } },
  },
}));

import {
  createGuestCheckoutSessionAction,
  loadGuestCartStateAction,
} from '@/app/[lang]/cart/actions';
import {
  addPhotoToCartAction,
  createCheckoutSessionAction,
  getCurrentCart,
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

/** Give every photographer in the test a connected Stripe account so checkout gating doesn't block on it. */
async function markConnected(photographerId: string) {
  await createServiceClient()
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographerId);
}

describe('T-117 — cart inventory integrity', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'talent';
    createSessionMock.mockClear();
  });

  // ─── (a) FK cascade — proves existing DB behavior, no new app code ───────
  describe('cross-user cleanup on photo/event deletion', () => {
    it("deleting a photo empties ANOTHER user's cart_items for it (on delete cascade)", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      expect(
        (
          await sb
            .from('cart_items')
            .select('id', { count: 'exact', head: true })
            .eq('cart_id', cart.id)
        ).count,
      ).toBe(1);

      // The photographer deletes the photo — a plain hard delete, no cart cleanup code involved.
      await sb.from('photos').delete().eq('id', photo.id);

      const { count } = await sb
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(0);
    });

    it("deleting an event's photos empties another user's cart_items too", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      const sb = createServiceClient();
      // Mirrors deleteEventPhotos: hard-delete the event's photos directly.
      await sb.from('photos').delete().eq('event_id', event.id);

      const cart = await getOrCreateCart(sb, talent.id);
      const { count } = await sb
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(0);
    });
  });

  // ─── (b) Authenticated cart self-heal + notice count ─────────────────────
  describe('getCurrentCart self-heal', () => {
    it('removes a cart item whose event was soft-deleted and reports removedCount', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      const sb = createServiceClient();
      await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id);

      const cartData = await getCurrentCart();

      expect(cartData.removedCount).toBe(1);
      expect(cartData.items).toHaveLength(0);

      const cart = await getOrCreateCart(sb, talent.id);
      const { count } = await sb
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(0);
    });

    it("removes a cart item whose photo's upload_status is no longer approved", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      const sb = createServiceClient();
      await sb.from('photos').update({ upload_status: 'rejected' }).eq('id', photo.id);

      const cartData = await getCurrentCart();

      expect(cartData.removedCount).toBe(1);
      expect(cartData.items).toHaveLength(0);
    });

    it('reports removedCount: 0 and deletes nothing for a fully-purchasable cart', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      const cartData = await getCurrentCart();

      expect(cartData.removedCount).toBe(0);
      expect(cartData.items).toHaveLength(1);
    });
  });

  // ─── (c) Guest cart validation ────────────────────────────────────────────
  describe('loadGuestCartStateAction', () => {
    it('reports a soft-deleted-event photo id as removed and excludes it from previews', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const sb = createServiceClient();
      await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id);

      const result = await loadGuestCartStateAction([photo.id]);

      expect(result.removedPhotoIds).toEqual([photo.id]);
      expect(result.previews[photo.id]).toBeUndefined();
    });

    it('keeps a fully-purchasable photo id out of removedPhotoIds', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });

      const result = await loadGuestCartStateAction([photo.id]);

      expect(result.removedPhotoIds).toEqual([]);
    });
  });

  // ─── (d) Checkout re-validation — never charge for an unpurchasable item ──
  describe('createCheckoutSessionAction re-validation', () => {
    it('rejects and never calls Stripe when the cart contains a soft-deleted-event photo', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      const sb = createServiceClient();
      await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id);

      expect(await createCheckoutSessionAction(true)).toEqual({
        ok: false,
        error: 'items_unavailable',
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it('succeeds unchanged when every cart item is purchasable', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      const result = await createCheckoutSessionAction(true);

      expect(result).toEqual({
        ok: true,
        url: 'https://checkout.stripe.test/session/cs_test_123',
      });
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    // T-189: mirror of the guest case — the authed buyer must learn *why*
    // checkout is blocked when a photographer isn't payout-ready, so the action
    // returns a typed code instead of a thrown (prod-redacted) Error.
    it('returns photographer_not_connected when the photographer is not active on Connect', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      // Deliberately NOT marked connected → stripe_connect_status stays non-active.
      const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      expect(await createCheckoutSessionAction(true)).toEqual({
        ok: false,
        error: 'photographer_not_connected',
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    // `getCartItemsWithDetails` (used to build Stripe line items) already
    // silently excludes soft-deleted-event items on its own — a naive
    // re-check built from ITS output would miss exactly this case in a mixed
    // cart and silently charge for a smaller cart than the user saw. The
    // re-validation must catch it against the RAW cart_items list instead.
    it('rejects a MIXED cart (one good + one soft-deleted-event item) rather than silently charging for just the good one', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const goodEvent = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const deadEvent = await createTestEvent(photographer.id, { price_per_photo: 5 });
      const goodPhoto = await createTestPhoto(goodEvent.id, { user_id: photographer.id });
      const deadPhoto = await createTestPhoto(deadEvent.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(goodPhoto.id);
      await addPhotoToCartAction(deadPhoto.id);

      const sb = createServiceClient();
      await sb
        .from('events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deadEvent.id);

      expect(await createCheckoutSessionAction(true)).toEqual({
        ok: false,
        error: 'items_unavailable',
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    });
  });

  describe('createGuestCheckoutSessionAction re-validation', () => {
    it('rejects and never calls Stripe when the cart contains a soft-deleted-event photo', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const sb = createServiceClient();
      await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id);

      expect(await createGuestCheckoutSessionAction([guestItem(photo.id)], true)).toEqual({
        ok: false,
        error: 'items_unavailable',
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it('succeeds unchanged when every requested photo is purchasable', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });

      const result = await createGuestCheckoutSessionAction([guestItem(photo.id)], true);

      expect(result).toEqual({
        ok: true,
        url: 'https://checkout.stripe.test/session/cs_test_123',
      });
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── (e) T-134: authenticated checkout re-validates ACCESSIBILITY ─────────
  //
  // T-132 gated the guest checkout on private-event access, but authed checkout
  // only re-validated purchasability. `cart_items` now persists the presented
  // share code (access_share_code) so authed checkout can re-validate at parity
  // with the guest path — closing the public→private-flip charge without
  // breaking legitimate private (share-code) or favorites (tag) purchases.

  /** Read the persisted access proof of a talent's only cart item. */
  async function readAccessShareCode(talentId: string): Promise<string | null> {
    const sb = createServiceClient();
    const cart = await getOrCreateCart(sb, talentId);
    const { data } = await sb
      .from('cart_items')
      .select('access_share_code')
      .eq('cart_id', cart.id)
      .single();
    return (data?.access_share_code as string | null) ?? null;
  }

  describe('persisted access proof (access_share_code)', () => {
    it('stores the presented code for a private-event add', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIV134',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id, 'PRIV134');

      expect(await readAccessShareCode(talent.id)).toBe('PRIV134');
    });

    it('stores null for a public-event add (no proof needed)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5, is_public: true });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;

      await addPhotoToCartAction(photo.id);

      expect(await readAccessShareCode(talent.id)).toBeNull();
    });

    it('stores null for the favorites/tag path (the live tag is the proof, not a code)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIVTAG134',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      await createServiceClient()
        .from('talent_photo_tags')
        .insert({ photo_id: photo.id, talent_user_id: talent.id, tagged_by_user_id: talent.id });
      mockSession.userId = talent.id;

      // No code presented — access granted by the tag.
      await addPhotoToCartAction(photo.id);

      expect(await readAccessShareCode(talent.id)).toBeNull();
    });
  });

  describe('authed checkout accessibility re-validation', () => {
    it('rejects a photo added while public then flipped private, with no code and no tag', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, { price_per_photo: 5, is_public: true });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id); // added while public → no stored code

      // Photographer flips the event private after it's in the cart.
      await createServiceClient().from('events').update({ is_public: false }).eq('id', event.id);

      expect(await createCheckoutSessionAction(true)).toEqual({
        ok: false,
        error: 'items_unavailable',
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it('still checks out a legitimate private purchase (correct code persisted)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIVOK134',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id, 'PRIVOK134');

      const result = await createCheckoutSessionAction(true);

      expect(result).toEqual({
        ok: true,
        url: 'https://checkout.stripe.test/session/cs_test_123',
      });
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    it('still checks out a favorites purchase (tagged, no code) via the live tag check', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIVFAV134',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      await createServiceClient()
        .from('talent_photo_tags')
        .insert({ photo_id: photo.id, talent_user_id: talent.id, tagged_by_user_id: talent.id });
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id); // favorites path, no code

      const result = await createCheckoutSessionAction(true);

      expect(result).toEqual({
        ok: true,
        url: 'https://checkout.stripe.test/session/cs_test_123',
      });
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    // Share-code rotation: the stored code is re-validated against the event's
    // CURRENT share_code every time, and a re-add through the new share link
    // refreshes the persisted proof (never stranded on the old code).
    it('re-proves access after a share-code rotation when the current code is re-presented', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'ROT_A',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id, 'ROT_A'); // stores ROT_A

      // Photographer rotates the share code; buyer re-adds via the new link.
      await createServiceClient().from('events').update({ share_code: 'ROT_B' }).eq('id', event.id);
      await addPhotoToCartAction(photo.id, 'ROT_B'); // idempotent re-add refreshes the proof

      expect(await readAccessShareCode(talent.id)).toBe('ROT_B');
      const result = await createCheckoutSessionAction(true);
      expect(result).toEqual({
        ok: true,
        url: 'https://checkout.stripe.test/session/cs_test_123',
      });
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    it('refuses after a share-code rotation when the stale code is never re-presented (no tag)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'ROT_A',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id, 'ROT_A'); // stores ROT_A

      // Rotation revokes the old link; buyer never re-presents the new code.
      await createServiceClient().from('events').update({ share_code: 'ROT_C' }).eq('id', event.id);

      expect(await createCheckoutSessionAction(true)).toEqual({
        ok: false,
        error: 'items_unavailable',
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    // Accepted fail-closed behavior (T-134 review): a favorites-added item's
    // proof IS the live tag. Un-saving the photo removes that proof, so the
    // item can no longer be checked out — parity with the guest path, which
    // never trusts a stale grant. Documented, intended, self-heals like T-117.
    it('refuses a favorites-added item after the buyer un-tags the photo', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      await markConnected(photographer.id);
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIVUNTAG134',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      await sb
        .from('talent_photo_tags')
        .insert({ photo_id: photo.id, talent_user_id: talent.id, tagged_by_user_id: talent.id });
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id); // favorites path, no stored code

      // Buyer removes the photo from their library — the only proof it had.
      await sb
        .from('talent_photo_tags')
        .delete()
        .eq('photo_id', photo.id)
        .eq('talent_user_id', talent.id);

      expect(await createCheckoutSessionAction(true)).toEqual({
        ok: false,
        error: 'items_unavailable',
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentCart self-heal drops inaccessible items (T-134)', () => {
    it('removes a public-then-private-flipped item with no valid proof and reports removedCount', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 5, is_public: true });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id);

      await createServiceClient().from('events').update({ is_public: false }).eq('id', event.id);

      const cartData = await getCurrentCart();

      expect(cartData.removedCount).toBe(1);
      expect(cartData.items).toHaveLength(0);

      const sb = createServiceClient();
      const cart = await getOrCreateCart(sb, talent.id);
      const { count } = await sb
        .from('cart_items')
        .select('id', { count: 'exact', head: true })
        .eq('cart_id', cart.id);
      expect(count).toBe(0);
    });

    it('keeps a private item whose persisted code still matches', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, {
        price_per_photo: 5,
        is_public: false,
        share_code: 'PRIVKEEP134',
      });
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      const talent = await createTestUser('TALENT');
      mockSession.userId = talent.id;
      await addPhotoToCartAction(photo.id, 'PRIVKEEP134');

      const cartData = await getCurrentCart();

      expect(cartData.removedCount).toBe(0);
      expect(cartData.items).toHaveLength(1);
    });
  });
});
