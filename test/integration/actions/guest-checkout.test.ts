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
async function seedPurchasablePhoto(): Promise<GuestCartItem> {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const sb = createServiceClient();
  await sb
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
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

  it('rejects an empty cart', async () => {
    await expect(createGuestCheckoutSessionAction([])).rejects.toThrow(/cart is empty/i);
  });

  it('creates a Stripe checkout session for a valid guest cart item', async () => {
    const item = await seedPurchasablePhoto();

    const result = await createGuestCheckoutSessionAction([item]);

    expect(result.url).toBe('https://checkout.stripe.test/session/cs_test_123');
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const sessionArgs = createSessionMock.mock.calls[0]?.[0] as {
      line_items: Array<{ price_data: { unit_amount: number } }>;
    };
    // Price re-validated server-side from the event's price_per_photo (10.00 → 1000 cents).
    expect(sessionArgs.line_items[0]?.price_data.unit_amount).toBe(1000);
  });

  // ─── Rate limit (T-085) ──────────────────────────────────────────────────
  //
  // `createGuestCheckoutSessionAction` is unauthenticated and hits the Stripe
  // API on every call — without a limiter, an anonymous caller can mint
  // unbounded checkout sessions. 11 calls in the same window (limit = 10)
  // must reject the 11th.

  it('rejects once the guest checkout rate limit is exceeded', async () => {
    const item = await seedPurchasablePhoto();

    // First 10 calls (the configured limit) succeed.
    for (let i = 0; i < 10; i++) {
      await expect(createGuestCheckoutSessionAction([item])).resolves.toMatchObject({
        url: expect.any(String),
      });
    }

    // The 11th call in the same window must be rejected — not forwarded to Stripe.
    createSessionMock.mockClear();
    await expect(createGuestCheckoutSessionAction([item])).rejects.toThrow();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
