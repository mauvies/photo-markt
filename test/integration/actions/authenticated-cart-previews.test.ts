/**
 * Integration tests for T-130: the authenticated cart was broken for photos
 * the buyer doesn't own, while the guest cart worked.
 *
 * Two layers of the same root cause — the buyer is not the photo's owner, and
 * both reads ran with the USER-SCOPED client against owner-only RLS:
 * (1) `getCartItemsWithDetails`'s `photos!inner` join silently dropped every
 *     foreign item (`photos` only has `own_photos_select`), emptying the cart
 *     display AND making checkout reject a real cart as empty;
 * (2) preview signing was denied by storage RLS on the photographer's path →
 *     `previewUrl: null` → icon fallback, and never used the baked thumbnail.
 * The guest cart already resolved everything via `supabaseAdmin` and worked.
 *
 * Unlike the other cart suites, `@/database/server` is mocked here to return
 * a REAL user-scoped client (`signInAs`) instead of a service-role stub —
 * that's the only way the RLS denials the bug depends on can reproduce.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/database/server', () => ({
  createClient: vi.fn(async () => {
    if (!holder.client) throw new Error('test: assign holder.client before calling the action');
    return holder.client;
  }),
  getUser: vi.fn(async () => {
    const client = holder.client as SupabaseClient | null;
    if (!client) return null;
    const { data } = await client.auth.getUser();
    return data.user;
  }),
}));

// Role gating isn't under test — the signed-in user is always the talent.
vi.mock('@/app/[lang]/actions/roles', () => ({
  userHasRole: vi.fn(async () => true),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
}));

const createSessionMock = vi.fn(async (..._args: unknown[]) => ({
  url: 'https://checkout.stripe.test/session/cs_test_t130',
}));
vi.mock('@/lib/stripe/config', () => ({
  stripe: {
    checkout: { sessions: { create: (...args: unknown[]) => createSessionMock(...args) } },
  },
}));

import {
  createCheckoutSessionAction,
  getCurrentCart,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { SERVICE_FEE_LINE_ITEM_NAME } from '@/lib/stripe/service-fee-line-item';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

/** Upload a stub byte at `path` so `createSignedUrl` has a real object to sign. */
async function uploadStubBytes(path: string) {
  await ensurePhotosBucket();
  const sb = createServiceClient();
  await sb.storage
    .from('photos')
    .upload(path, new Uint8Array([0xff]), { contentType: 'image/jpeg', upsert: true });
}

/** Photographer-owned purchasable photo sitting in the signed-in talent's cart. */
async function seedCartWithForeignPhoto() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  // Connected Stripe account so the checkout test isn't blocked by gating.
  await createServiceClient()
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_t130' })
    .eq('id', photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
  const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
  await uploadStubBytes(originalUrl);
  const photo = await createTestPhoto(event.id, {
    user_id: photographer.id,
    original_url: originalUrl,
  });

  const talent = await createTestUser('TALENT');
  const userClient = await signInAs(talent.email);
  holder.client = userClient;

  const sb = createServiceClient();
  const { data: cart } = await sb
    .from('carts')
    .insert({ user_id: talent.id })
    .select('id')
    .single();
  if (!cart) throw new Error('failed to seed cart');
  await sb.from('cart_items').insert({
    cart_id: cart.id,
    photo_id: photo.id,
    photographer_id: photographer.id,
    unit_price_cents: 1000,
  });

  return { photo };
}

describe('T-130 — authenticated cart preview resolution', () => {
  beforeEach(async () => {
    await resetDatabase();
    holder.client = null;
    createSessionMock.mockClear();
  });

  it("lists the item and returns a watermarked previewUrl for a purchasable photo the talent doesn't own (thumbnail not baked)", async () => {
    const { photo } = await seedCartWithForeignPhoto();

    const cartData = await getCurrentCart();

    // Before T-130 this was empty: the user-scoped `photos!inner` join was
    // RLS-filtered because the buyer doesn't own the photo row.
    expect(cartData.items).toHaveLength(1);
    expect(cartData.items[0].photoId).toBe(photo.id);
    // The seeded event is watermark_enabled (DB default), so the pre-bake
    // fallback must go through the fail-closed /api/watermark/ route (T-131) —
    // NEVER a direct signed URL of the payment-gated original.
    expect(cartData.items[0].previewUrl).toBeTruthy();
    expect(cartData.items[0].previewUrl).toContain('/api/watermark/');
    expect(cartData.items[0].previewUrl).not.toContain('/storage/v1/object/sign/');
  });

  it('serves the baked immutable thumbnail when thumbnail_status is ready', async () => {
    const { photo } = await seedCartWithForeignPhoto();
    await createServiceClient()
      .from('photos')
      .update({ thumbnail_status: 'ready', thumb_version: 2 })
      .eq('id', photo.id);

    const cartData = await getCurrentCart();

    // Before T-130 the authenticated cart always signed the original and
    // never used the baked thumbnail (unlike the guest cart).
    expect(cartData.items[0].previewUrl).toContain('/api/thumb/');
    expect(cartData.items[0].previewUrl).toContain('?v=2');
    expect(cartData.items[0].previewUrl).not.toContain('/storage/v1/object/sign/');
  });

  it('checkout sees the foreign item instead of rejecting the cart as empty', async () => {
    await seedCartWithForeignPhoto();

    const result = await createCheckoutSessionAction(true);

    // Before T-130, the user-scoped details read came back empty and checkout
    // threw 'Cart is empty' for a cart with a real purchasable item in it.
    expect(result.ok).toBe(true);
    expect(result.ok && result.url).toContain('checkout.stripe.test');
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const args = createSessionMock.mock.calls[0][0] as {
      line_items: Array<{ price_data: { currency: string; product_data: { name: string } } }>;
    };
    // T-196/T-199: the session also carries the buyer service-fee line item, so
    // count the PHOTO line items — the point here is that the foreign item made
    // it into the session at all.
    const photoLineItems = args.line_items.filter(
      (i) => i.price_data.product_data.name !== SERVICE_FEE_LINE_ITEM_NAME,
    );
    expect(photoLineItems).toHaveLength(1);
    // T-193: the authenticated checkout must charge in EUR (platform settlement
    // currency), not USD — otherwise every sale eats a ~2% conversion fee.
    expect(photoLineItems[0]?.price_data.currency).toBe('eur');
    // The fee rides in the same currency.
    for (const item of args.line_items) {
      expect(item.price_data.currency).toBe('eur');
    }
  });
});
