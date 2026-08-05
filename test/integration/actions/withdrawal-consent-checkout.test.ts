/**
 * Integration tests for the right-of-withdrawal consent gate (T-228).
 *
 * The legal exemption in Directive 2011/83/EU art. 16(m) only exists if the
 * consumer expressly consented to immediate delivery AND acknowledged losing
 * the withdrawal right. A checkbox that only disables a button proves nothing —
 * the client can call a Server Action directly — so what these pin is that the
 * SERVER refuses to create the Stripe session without the consent, in BOTH
 * flows, and that the consent it does accept reaches the session metadata the
 * webhook later persists.
 *
 * Stripe is mocked; the assertion "no session was created" is the whole point
 * of the rejection cases.
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

import { createGuestCheckoutSessionAction } from '@/app/[lang]/cart/actions';
import {
  addPhotoToCartAction,
  createCheckoutSessionAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import type { GuestCartItem } from '@/lib/guest-cart';
import {
  WITHDRAWAL_CONSENT_AT_KEY,
  WITHDRAWAL_CONSENT_VERSION,
  WITHDRAWAL_CONSENT_VERSION_KEY,
} from '@/lib/withdrawal-consent';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

function lastSessionMetadata(): Record<string, string> {
  const params = createSessionMock.mock.calls.at(-1)?.[0] as {
    metadata?: Record<string, string>;
  };
  return params?.metadata ?? {};
}

async function seedPurchasablePhoto() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  await createServiceClient()
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
  const photo = await createTestPhoto(event.id, { user_id: photographer.id });
  return { photographer, event, photo };
}

function guestItem(photoId: string, photographerId: string, eventId: string): GuestCartItem {
  return {
    photoId,
    photographerId,
    eventId,
    eventName: 'Test Event',
    eventDate: null,
    unitPriceCents: 500,
    previewUrl: null,
  };
}

beforeEach(async () => {
  await resetDatabase();
  mockSession.userId = null;
  mockSession.activeRole = 'talent';
  createSessionMock.mockClear();
});

describe('guest checkout — withdrawal consent gate', () => {
  it('refuses to create a Stripe session without the consent', async () => {
    const { photographer, event, photo } = await seedPurchasablePhoto();

    const result = await createGuestCheckoutSessionAction(
      [guestItem(photo.id, photographer.id, event.id)],
      false,
    );

    expect(result).toEqual({ ok: false, error: 'consent_required' });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('stamps the consent into the session metadata when given', async () => {
    const { photographer, event, photo } = await seedPurchasablePhoto();

    const result = await createGuestCheckoutSessionAction(
      [guestItem(photo.id, photographer.id, event.id)],
      true,
    );

    expect(result.ok).toBe(true);
    const metadata = lastSessionMetadata();
    expect(metadata[WITHDRAWAL_CONSENT_VERSION_KEY]).toBe(WITHDRAWAL_CONSENT_VERSION);
    // A real instant, stamped server-side — the client never sends one.
    expect(Number.isNaN(Date.parse(metadata[WITHDRAWAL_CONSENT_AT_KEY]))).toBe(false);
  });

  it('rejects before the rate limiter, so a consent-less client cannot burn the quota', async () => {
    const { photographer, event, photo } = await seedPurchasablePhoto();
    const item = guestItem(photo.id, photographer.id, event.id);

    // The IP limiter allows 10/h. Twelve consent-less attempts must not consume
    // any of them: the buyer who then ticks the box still gets their checkout.
    for (let i = 0; i < 12; i++) {
      expect(await createGuestCheckoutSessionAction([item], false)).toEqual({
        ok: false,
        error: 'consent_required',
      });
    }

    const result = await createGuestCheckoutSessionAction([item], true);
    expect(result.ok).toBe(true);
  });
});

describe('authenticated checkout — withdrawal consent gate', () => {
  async function seedTalentCart() {
    const seeded = await seedPurchasablePhoto();
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    await addPhotoToCartAction(seeded.photo.id);
    return { ...seeded, talent };
  }

  it('refuses to create a Stripe session without the consent', async () => {
    await seedTalentCart();

    const result = await createCheckoutSessionAction(false);

    expect(result).toEqual({ ok: false, error: 'consent_required' });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('stamps the consent into the session metadata when given', async () => {
    await seedTalentCart();

    const result = await createCheckoutSessionAction(true);

    expect(result.ok).toBe(true);
    const metadata = lastSessionMetadata();
    expect(metadata[WITHDRAWAL_CONSENT_VERSION_KEY]).toBe(WITHDRAWAL_CONSENT_VERSION);
    expect(Number.isNaN(Date.parse(metadata[WITHDRAWAL_CONSENT_AT_KEY]))).toBe(false);
    // The pre-existing routing metadata must survive the addition.
    expect(metadata.user_id).toBeTruthy();
    expect(metadata.cart_id).toBeTruthy();
  });
});
