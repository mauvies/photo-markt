/**
 * Integration tests for `createGuestCheckoutSessionAction`
 * (`src/app/[lang]/cart/actions.ts`).
 *
 * This Server Action creates a Stripe Checkout Session (real $$$ API call)
 * with NO authentication — any anonymous caller can invoke it directly.
 * Before T-085 it also had no rate limit, so an anonymous caller could mint
 * unlimited Stripe sessions (plus one DB read of all `photoIds` per call).
 *
 * Stripe itself is mocked — these tests pin the guest-facing behavior
 * (successful checkout for a valid cart) and the rate-limit guard, not
 * Stripe's API.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionMock = vi.fn(async (..._args: unknown[]) => ({
  url: 'https://checkout.stripe.test/session/cs_test_123',
}));

vi.mock('@/lib/stripe/config', () => ({
  stripe: {
    checkout: { sessions: { create: (...args: unknown[]) => createSessionMock(...args) } },
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
}));

import { createGuestCheckoutSessionAction } from '@/app/[lang]/cart/actions';
import type { GuestCartItem } from '@/lib/guest-cart';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Seed a photographer with an active Stripe Connect account, one priced event, one photo. */
async function seedPurchasablePhoto(
  eventOverrides?: Parameters<typeof createTestEvent>[1],
): Promise<GuestCartItem> {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const sb = createServiceClient();
  await sb
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: 10, ...eventOverrides });
  const photo = await createTestPhoto(event.id, { user_id: photographer.id });
  return {
    photoId: photo.id,
    photographerId: photographer.id,
    eventId: event.id,
    eventName: 'Fallback Name',
    eventDate: null,
    unitPriceCents: 1000,
    previewUrl: null,
  };
}

describe('createGuestCheckoutSessionAction', () => {
  beforeEach(async () => {
    await resetDatabase();
    createSessionMock.mockClear();
  });

  it('returns cart_empty for an empty cart', async () => {
    // T-189: expected failures now come back as a typed code instead of a
    // thrown Error (Next redacts thrown Server Action messages in prod).
    expect(await createGuestCheckoutSessionAction([], true)).toEqual({
      ok: false,
      error: 'cart_empty',
    });
  });

  it('creates a Stripe checkout session for a valid guest cart item', async () => {
    const item = await seedPurchasablePhoto();

    const result = await createGuestCheckoutSessionAction([item], true);

    expect(result).toEqual({
      ok: true,
      url: 'https://checkout.stripe.test/session/cs_test_123',
    });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const sessionArgs = createSessionMock.mock.calls[0]?.[0] as {
      line_items: Array<{ price_data: { unit_amount: number; currency: string } }>;
    };
    // Price re-validated server-side from the event's price_per_photo (10.00 → 1000 cents).
    expect(sessionArgs.line_items[0]?.price_data.unit_amount).toBe(1000);
    // T-193: the platform settles in EUR — charging USD forced a ~2% conversion
    // fee on every sale. The checkout session must be created in EUR.
    expect(sessionArgs.line_items[0]?.price_data.currency).toBe('eur');
  });

  // T-189: the buyer must learn *why* checkout is blocked. When a photo's
  // photographer isn't payout-ready (Stripe Connect not `active`), the action
  // returns a typed `photographer_not_connected` code (mapped client-side to
  // localized copy) instead of a thrown Error that Next redacts in prod.
  it('returns photographer_not_connected when a photographer is not active on Connect', async () => {
    const item = await seedPurchasablePhoto();
    const sb = createServiceClient();
    await sb
      .from('profiles')
      .update({ stripe_connect_status: 'pending' })
      .eq('id', item.photographerId);

    const result = await createGuestCheckoutSessionAction([item], true);

    expect(result).toEqual({ ok: false, error: 'photographer_not_connected' });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  // T-132: a private event is reachable only via its share code. A guest
  // checkout item from a private event must carry the event's real share code
  // (the proof stashed at add time) — otherwise the session is refused, never
  // charged, so a crafted cart for a private photo can't buy it.
  it('refuses to check out a private-event item with no share code (T-132)', async () => {
    const item = await seedPurchasablePhoto({ is_public: false, share_code: 'PRIVCHK' });

    expect(await createGuestCheckoutSessionAction([item], true)).toEqual({
      ok: false,
      error: 'items_unavailable',
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('refuses a private-event item with the wrong share code (T-132)', async () => {
    const item = await seedPurchasablePhoto({ is_public: false, share_code: 'PRIVCHK' });

    expect(
      await createGuestCheckoutSessionAction([{ ...item, eventShareCode: 'NOPE' }], true),
    ).toEqual({
      ok: false,
      error: 'items_unavailable',
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('checks out a private-event item when it carries the correct share code (T-132)', async () => {
    const item = await seedPurchasablePhoto({ is_public: false, share_code: 'PRIVCHK' });

    const result = await createGuestCheckoutSessionAction(
      [{ ...item, eventShareCode: 'PRIVCHK' }],
      true,
    );

    expect(result).toEqual({
      ok: true,
      url: 'https://checkout.stripe.test/session/cs_test_123',
    });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  // ─── Rate limit (T-085) ──────────────────────────────────────────────────
  //
  // `createGuestCheckoutSessionAction` is unauthenticated and hits the Stripe
  // API on every call — without a limiter, an anonymous caller can mint
  // unbounded checkout sessions. 11 calls in the same window (limit = 10)
  // must reject the 11th.

  it('returns rate_limited once the guest checkout rate limit is exceeded', async () => {
    const item = await seedPurchasablePhoto();

    // First 10 calls (the configured limit) succeed.
    for (let i = 0; i < 10; i++) {
      await expect(createGuestCheckoutSessionAction([item], true)).resolves.toMatchObject({
        ok: true,
        url: expect.any(String),
      });
    }

    // The 11th call in the same window is refused with a typed code — not forwarded to Stripe.
    createSessionMock.mockClear();
    expect(await createGuestCheckoutSessionAction([item], true)).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
