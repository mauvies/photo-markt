/**
 * End-to-end proof that the buyer service fee is actually ON, with the REAL
 * shipped constants (T-199) — no mock of `@/lib/plans` anywhere in this file.
 *
 * Its sibling `buyer-service-fee-checkout.test.ts` overrides the amounts to
 * test the *mechanism* independently of whatever numbers are configured this
 * month. This file is the complement: it pins that a real guest checkout, with
 * the constants exactly as deployed, bills the buyer the fee. If someone sets
 * the constants back to 0, this file is what says so out loud.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
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
import type { GuestCartItem } from '@/lib/guest-cart';
import {
  BUYER_SERVICE_FEE_BPS,
  BUYER_SERVICE_FEE_FIXED_CENTS,
  getBuyerServiceFeeCents,
} from '@/lib/plans';
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

function lastLineItems(): LineItem[] {
  const params = createSessionMock.mock.calls.at(-1)?.[0] as { line_items: LineItem[] };
  return params.line_items;
}

async function seedPricedPhoto(pricePerPhoto: number): Promise<GuestCartItem> {
  const photographer = await createTestUser('PHOTOGRAPHER');
  await createServiceClient()
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: pricePerPhoto });
  const photo = await createTestPhoto(event.id, { user_id: photographer.id });
  return {
    photoId: photo.id,
    photographerId: photographer.id,
    eventId: event.id,
    eventName: 'Test Event',
    eventDate: null,
    unitPriceCents: Math.round(pricePerPhoto * 100),
    previewUrl: null,
  };
}

beforeEach(async () => {
  await resetDatabase();
  createSessionMock.mockClear();
});

describe('the buyer service fee is live', () => {
  it('is configured to charge something', () => {
    expect(BUYER_SERVICE_FEE_FIXED_CENTS + BUYER_SERVICE_FEE_BPS).toBeGreaterThan(0);
  });

  it('bills a real €10 guest checkout €10.55', async () => {
    const item = await seedPricedPhoto(10);

    const result = await createGuestCheckoutSessionAction([item]);

    expect(result.ok).toBe(true);
    const items = lastLineItems();
    const fee = items.find((i) => i.price_data.product_data.name === SERVICE_FEE_LINE_ITEM_NAME);

    expect(fee?.price_data.unit_amount).toBe(55);
    const total = items.reduce((sum, i) => sum + i.price_data.unit_amount * i.quantity, 0);
    expect(total).toBe(1055);
  });

  it('charges exactly what the cart would display for that subtotal', async () => {
    // Same function, same number — the cart calls `getBuyerServiceFeeCents`
    // directly, so a divergence here would mean the receipt disagreeing with
    // what the buyer was shown.
    const item = await seedPricedPhoto(10);

    await createGuestCheckoutSessionAction([item]);
    const fee = lastLineItems().find(
      (i) => i.price_data.product_data.name === SERVICE_FEE_LINE_ITEM_NAME,
    );

    expect(fee?.price_data.unit_amount).toBe(getBuyerServiceFeeCents(1000));
  });

  it('leaves a free event free — no fee on a €0 cart', async () => {
    const item = await seedPricedPhoto(0);

    await createGuestCheckoutSessionAction([item]);
    const items = lastLineItems();

    expect(items.some((i) => i.price_data.product_data.name === SERVICE_FEE_LINE_ITEM_NAME)).toBe(
      false,
    );
    expect(items.reduce((sum, i) => sum + i.price_data.unit_amount, 0)).toBe(0);
  });
});
