/**
 * Integration tests for the buyer service fee in both checkout flows
 * (billing v2, T-196; amounts switched on in T-199).
 *
 * `getBuyerServiceFeeCents` is overridden here rather than relying on the
 * shipped constants: the property under test is that each checkout itemizes
 * the fee AS ITS OWN LINE ITEM, off the SERVER-validated subtotal, using the
 * shared calc point — not what the amount happens to be this month. The last
 * block drives the fee to 0 to prove the kill-switch still produces a v1
 * session, which is what a rollback relies on.
 *
 * Stripe is mocked; these pin the session payload we hand it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

/**
 * Fee = 30 cents fixed + 1.5% — the design's provisional values. Toggled off by
 * setting it to a passthrough of the real function in the kill-switch block.
 */
const feeMock = vi.hoisted(() => ({
  /** Fixed cents; set to 0 together with `bps` to exercise the kill-switch. */
  fixed: 30,
  bps: 150,
  compute(subtotalCents: number) {
    if (subtotalCents <= 0) return 0;
    if (this.fixed === 0 && this.bps === 0) return 0;
    return this.fixed + Math.round((subtotalCents * this.bps) / 10000);
  },
}));

vi.mock('@/lib/plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plans')>();
  return {
    ...actual,
    getBuyerServiceFeeCents: (subtotalCents: number) => feeMock.compute(subtotalCents),
  };
});

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
import { SERVICE_FEE_LINE_ITEM_NAME } from '@/lib/stripe/service-fee-line-item';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

interface LineItem {
  price_data: { unit_amount: number; currency: string; product_data: { name: string } };
  quantity: number;
}

/** The `line_items` array handed to Stripe on the most recent call. */
function lastLineItems(): LineItem[] {
  const params = createSessionMock.mock.calls.at(-1)?.[0] as { line_items: LineItem[] };
  return params.line_items;
}

function feeLineItems(): LineItem[] {
  return lastLineItems().filter(
    (i) => i.price_data.product_data.name === SERVICE_FEE_LINE_ITEM_NAME,
  );
}

async function markConnected(photographerId: string) {
  await createServiceClient()
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographerId);
}

/** Photographer (payout-ready) + priced event + one approved photo. */
async function seedPhoto(pricePerPhoto: number) {
  const photographer = await createTestUser('PHOTOGRAPHER');
  await markConnected(photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: pricePerPhoto });
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
    // Deliberately wrong: the action must price from the DB, not from this.
    unitPriceCents: 999_999,
    previewUrl: null,
  };
}

beforeEach(async () => {
  await resetDatabase();
  mockSession.userId = null;
  mockSession.activeRole = 'talent';
  createSessionMock.mockClear();
  feeMock.fixed = 30;
  feeMock.bps = 150;
});

describe('guest checkout — service fee line item', () => {
  it('adds exactly one fee line item on top of the photo line items', async () => {
    const { photographer, event, photo } = await seedPhoto(10);

    const result = await createGuestCheckoutSessionAction([
      guestItem(photo.id, photographer.id, event.id),
    ]);

    expect(result.ok).toBe(true);
    const items = lastLineItems();
    // 1 photo + 1 fee
    expect(items).toHaveLength(2);
    expect(feeLineItems()).toHaveLength(1);
  });

  it('prices the fee off the SERVER-validated subtotal, not the client figure', async () => {
    const { photographer, event, photo } = await seedPhoto(10);

    // The guest item claims €9999.99; the event says €10.00.
    await createGuestCheckoutSessionAction([guestItem(photo.id, photographer.id, event.id)]);

    // 30 + round(1000 * 150 / 10000) = 30 + 15 = 45
    expect(feeLineItems()[0].price_data.unit_amount).toBe(45);
  });

  it('charges the fee once for a multi-photo cart, on the summed subtotal', async () => {
    const { photographer, event, photo } = await seedPhoto(10);
    const photo2 = await createTestPhoto(event.id, { user_id: photographer.id });

    await createGuestCheckoutSessionAction([
      guestItem(photo.id, photographer.id, event.id),
      guestItem(photo2.id, photographer.id, event.id),
    ]);

    const items = lastLineItems();
    expect(items).toHaveLength(3); // 2 photos + 1 fee
    // subtotal 2000 → 30 + 30 = 60
    expect(feeLineItems()[0].price_data.unit_amount).toBe(60);
  });

  it('makes the session total equal subtotal + fee', async () => {
    const { photographer, event, photo } = await seedPhoto(10);

    await createGuestCheckoutSessionAction([guestItem(photo.id, photographer.id, event.id)]);

    const total = lastLineItems().reduce(
      (sum, i) => sum + i.price_data.unit_amount * i.quantity,
      0,
    );
    expect(total).toBe(1000 + 45);
  });

  it('bills the fee in the platform currency', async () => {
    const { photographer, event, photo } = await seedPhoto(10);

    await createGuestCheckoutSessionAction([guestItem(photo.id, photographer.id, event.id)]);

    expect(feeLineItems()[0].price_data.currency).toBe('eur');
  });

  it('adds no fee when the cart is entirely free', async () => {
    // A free event has no charge at all, so it must not acquire a lone fee.
    const { photographer, event, photo } = await seedPhoto(0);

    await createGuestCheckoutSessionAction([guestItem(photo.id, photographer.id, event.id)]);

    expect(feeLineItems()).toHaveLength(0);
  });
});

describe('authenticated checkout — service fee line item', () => {
  it('adds exactly one fee line item, priced off the validated subtotal', async () => {
    const { photo } = await seedPhoto(10);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    await addPhotoToCartAction(photo.id);

    const result = await createCheckoutSessionAction();

    expect(result.ok).toBe(true);
    expect(lastLineItems()).toHaveLength(2);
    expect(feeLineItems()).toHaveLength(1);
    expect(feeLineItems()[0].price_data.unit_amount).toBe(45);
  });

  it('matches the guest flow exactly for the same cart', async () => {
    const { photographer, event, photo } = await seedPhoto(10);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    await addPhotoToCartAction(photo.id);

    await createCheckoutSessionAction();
    const authedFee = feeLineItems()[0];

    mockSession.userId = null;
    createSessionMock.mockClear();
    await createGuestCheckoutSessionAction([guestItem(photo.id, photographer.id, event.id)]);
    const guestFee = feeLineItems()[0];

    expect(authedFee).toEqual(guestFee);
  });

  it('charges the fee once on the summed subtotal of a multi-photo cart', async () => {
    const { photographer, event, photo } = await seedPhoto(10);
    const photo2 = await createTestPhoto(event.id, { user_id: photographer.id });
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    await addPhotoToCartAction(photo.id);
    await addPhotoToCartAction(photo2.id);

    await createCheckoutSessionAction();

    expect(lastLineItems()).toHaveLength(3);
    expect(feeLineItems()[0].price_data.unit_amount).toBe(60);
  });
});

describe('kill-switch — a fee of 0 adds no line item', () => {
  // What a rollback relies on: set the amounts back to 0 and the session is
  // byte-identical to the pre-v2 one, with no code revert needed beyond the
  // constants.
  beforeEach(() => {
    feeMock.fixed = 0;
    feeMock.bps = 0;
  });

  it('guest checkout sends photo line items only', async () => {
    const { photographer, event, photo } = await seedPhoto(10);

    await createGuestCheckoutSessionAction([guestItem(photo.id, photographer.id, event.id)]);

    expect(lastLineItems()).toHaveLength(1);
    expect(feeLineItems()).toHaveLength(0);
  });

  it('authenticated checkout sends photo line items only', async () => {
    const { photo } = await seedPhoto(10);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    await addPhotoToCartAction(photo.id);

    await createCheckoutSessionAction();

    expect(lastLineItems()).toHaveLength(1);
    expect(feeLineItems()).toHaveLength(0);
  });
});
