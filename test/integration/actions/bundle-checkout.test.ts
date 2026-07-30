/**
 * Integration tests for volume pricing in both checkout flows (T-204).
 *
 * This is the deploy where bundles start moving money, so these pin the money
 * properties rather than the UI:
 *
 *  - the charged total equals `getBundlePriceCents` of the SERVER-validated set;
 *  - the per-photo allocation sums to EXACTLY that total (the property that keeps
 *    the photographer transfer honest — `order_items` feeds it);
 *  - exactly one service-fee line item, computed on the POST-DISCOUNT subtotal;
 *  - a client-supplied price is ignored;
 *  - a cart spanning two events discounts only the qualifying group;
 *  - an unbundled cart produces byte-identical line items to before bundles.
 *
 * The service fee is driven from a mock, as in `buyer-service-fee-checkout`: the
 * property under test is which subtotal it rides on, not what the constant is
 * this month.
 *
 * Stripe is mocked; these pin the session payload we hand it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

const feeMock = vi.hoisted(() => ({
  fixed: 0,
  bps: 0,
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
  getCurrentCart,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import type { BundleTier } from '@/lib/bundle-pricing';
import { getBundlePriceCents } from '@/lib/bundle-pricing';
import type { GuestCartItem } from '@/lib/guest-cart';
import { SERVICE_FEE_LINE_ITEM_NAME } from '@/lib/stripe/service-fee-line-item';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** The user's design ladder: €5 a photo · 3+ €12 · 8+ €20. */
const LADDER: BundleTier[] = [
  { minQuantity: 3, totalPriceCents: 1200 },
  { minQuantity: 8, totalPriceCents: 2000 },
];

interface LineItem {
  price_data: { unit_amount: number; currency: string; product_data: { name: string } };
  quantity: number;
}

function lastSessionParams(): {
  line_items: LineItem[];
  metadata?: Record<string, string>;
} {
  return createSessionMock.mock.calls.at(-1)?.[0] as {
    line_items: LineItem[];
    metadata?: Record<string, string>;
  };
}

function lastLineItems(): LineItem[] {
  return lastSessionParams().line_items;
}

function photoLineItems(): LineItem[] {
  return lastLineItems().filter(
    (i) => i.price_data.product_data.name !== SERVICE_FEE_LINE_ITEM_NAME,
  );
}

function feeLineItems(): LineItem[] {
  return lastLineItems().filter(
    (i) => i.price_data.product_data.name === SERVICE_FEE_LINE_ITEM_NAME,
  );
}

function photoTotal(): number {
  return photoLineItems().reduce((sum, i) => sum + i.price_data.unit_amount * i.quantity, 0);
}

/** The allocated cents the guest flow committed into the `cart_<i>` metadata. */
function guestMetadataAllocations(): number[] {
  const metadata = lastSessionParams().metadata ?? {};
  const count = Number.parseInt(metadata.cart_count ?? '0', 10);
  return Array.from({ length: count }, (_, i) => JSON.parse(metadata[`cart_${i}`]).c as number);
}

async function markConnected(photographerId: string) {
  await createServiceClient()
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographerId);
}

/** Payout-ready photographer + a priced event carrying `tiers` + N photos. */
async function seedBundledEvent(
  photoCount: number,
  options: {
    pricePerPhoto?: number;
    tiers?: BundleTier[] | null;
    allPhotosCents?: number | null;
  } = {},
) {
  const { pricePerPhoto = 5, tiers = LADDER, allPhotosCents = null } = options;
  const photographer = await createTestUser('PHOTOGRAPHER');
  await markConnected(photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: pricePerPhoto });
  await createServiceClient()
    .from('events')
    .update({ bundle_tiers: tiers, bundle_all_photos_cents: allPhotosCents })
    .eq('id', event.id);
  const photos = [];
  for (let i = 0; i < photoCount; i++) {
    photos.push(await createTestPhoto(event.id, { user_id: photographer.id }));
  }
  return { photographer, event, photos };
}

function guestItem(photoId: string, photographerId: string, eventId: string): GuestCartItem {
  return {
    photoId,
    photographerId,
    eventId,
    eventName: 'Test Event',
    eventDate: null,
    // Deliberately absurd: the action must price from the DB, never from this.
    unitPriceCents: 999_999,
    previewUrl: null,
  };
}

beforeEach(async () => {
  await resetDatabase();
  mockSession.userId = null;
  mockSession.activeRole = 'talent';
  createSessionMock.mockClear();
  feeMock.fixed = 0;
  feeMock.bps = 0;
});

describe('guest checkout — bundle pricing', () => {
  it('charges the rung total, split exactly across the photos', async () => {
    const { photographer, event, photos } = await seedBundledEvent(3);

    const result = await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    expect(result.ok).toBe(true);
    // 3 × €5 = €15 at list; the 3+ rung charges €12.
    expect(photoTotal()).toBe(1200);
    expect(photoTotal()).toBe(getBundlePriceCents(3, 500, LADDER));
    expect(photoLineItems().map((i) => i.price_data.unit_amount)).toEqual([400, 400, 400]);
  });

  it('commits the same allocation into the cart metadata the webhook reads', async () => {
    const { photographer, event, photos } = await seedBundledEvent(3);

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    const allocations = guestMetadataAllocations();
    expect(allocations).toHaveLength(3);
    expect(allocations.reduce((a, b) => a + b, 0)).toBe(1200);
    // The metadata and the line items must agree — the buyer's card statement
    // and the resulting order rows are built from these two respectively.
    expect(allocations).toEqual(photoLineItems().map((i) => i.price_data.unit_amount));
  });

  it('splits an indivisible total to exactly the total', async () => {
    // 7 photos reach the 3+ rung: €12 across 7 photos does not divide evenly.
    const { photographer, event, photos } = await seedBundledEvent(7);

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    expect(photoTotal()).toBe(1200);
    expect(guestMetadataAllocations().reduce((a, b) => a + b, 0)).toBe(1200);
  });

  it('ignores the price the client sent', async () => {
    const { photographer, event, photos } = await seedBundledEvent(3);

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    // The guest items claimed €9,999.99 each.
    expect(photoTotal()).toBe(1200);
  });

  it('does not discount below the first threshold', async () => {
    const { photographer, event, photos } = await seedBundledEvent(2);

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    expect(photoTotal()).toBe(1000);
    expect(photoLineItems().map((i) => i.price_data.unit_amount)).toEqual([500, 500]);
  });

  it('applies the "all photos" ceiling with no rungs configured', async () => {
    const { photographer, event, photos } = await seedBundledEvent(6, {
      tiers: null,
      allPhotosCents: 2000,
    });

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    // 6 × €5 = €30 at list, capped at the €20 Foto-Flat.
    expect(photoTotal()).toBe(2000);
  });

  it('discounts only the qualifying group in a cart spanning two events', async () => {
    const bundled = await seedBundledEvent(3);
    const other = await seedBundledEvent(1, { tiers: null });

    await createGuestCheckoutSessionAction([
      ...bundled.photos.map((p) => guestItem(p.id, bundled.photographer.id, bundled.event.id)),
      guestItem(other.photos[0].id, other.photographer.id, other.event.id),
    ]);

    // €12 for the bundled group + €5 for the untouched single.
    expect(photoTotal()).toBe(1700);
  });

  it('charges one service-fee line item on the DISCOUNTED subtotal', async () => {
    feeMock.fixed = 25;
    feeMock.bps = 300;
    const { photographer, event, photos } = await seedBundledEvent(3);

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    expect(feeLineItems()).toHaveLength(1);
    // On €12, not on the €15 list subtotal: 25 + round(1200 × 300 / 10000) = 61.
    expect(feeLineItems()[0].price_data.unit_amount).toBe(61);
  });

  it('leaves an unbundled event exactly as it was before bundles', async () => {
    const { photographer, event, photos } = await seedBundledEvent(3, { tiers: null });

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    expect(photoTotal()).toBe(1500);
    expect(photoLineItems().map((i) => i.price_data.unit_amount)).toEqual([500, 500, 500]);
    expect(guestMetadataAllocations()).toEqual([500, 500, 500]);
  });
});

describe('authenticated checkout — bundle pricing', () => {
  async function seedTalentCart(
    photoCount: number,
    options?: Parameters<typeof seedBundledEvent>[1],
  ) {
    const seeded = await seedBundledEvent(photoCount, options);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    for (const photo of seeded.photos) {
      await addPhotoToCartAction(photo.id);
    }
    return { ...seeded, talent };
  }

  /** The committed allocation on the talent's cart rows. */
  async function storedAllocations(talentId: string): Promise<Array<number | null>> {
    const sb = createServiceClient();
    const { data: cart } = await sb
      .from('carts')
      .select('id')
      .eq('user_id', talentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const { data } = await sb
      .from('cart_items')
      .select('allocated_price_cents')
      .eq('cart_id', cart!.id);
    return (data ?? []).map((row) => row.allocated_price_cents as number | null);
  }

  it('charges the rung total and commits the allocation before the session exists', async () => {
    const { talent } = await seedTalentCart(3);

    const result = await createCheckoutSessionAction();

    expect(result.ok).toBe(true);
    expect(photoTotal()).toBe(1200);
    const allocations = await storedAllocations(talent.id);
    expect(allocations).toHaveLength(3);
    expect(allocations.reduce<number>((sum, c) => sum + (c ?? 0), 0)).toBe(1200);
  });

  it('matches the guest flow for the same set of photos', async () => {
    const { photographer, event, photos } = await seedBundledEvent(3);
    const talent = await createTestUser('TALENT');
    mockSession.userId = talent.id;
    for (const photo of photos) await addPhotoToCartAction(photo.id);

    await createCheckoutSessionAction();
    const authedTotal = photoTotal();

    mockSession.userId = null;
    createSessionMock.mockClear();
    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    expect(authedTotal).toBe(photoTotal());
  });

  it('commits NO allocation for an unbundled cart, leaving the pre-bundle order shape', async () => {
    const { talent } = await seedTalentCart(3, { tiers: null });

    await createCheckoutSessionAction();

    expect(photoTotal()).toBe(1500);
    // Null throughout: every downstream reader falls back to unit_price_cents,
    // which is exactly the pre-bundle behaviour.
    expect(await storedAllocations(talent.id)).toEqual([null, null, null]);
  });

  it('clears a stale allocation when the cart shrinks below the rung', async () => {
    const { talent, photos } = await seedTalentCart(3);

    // First checkout commits the 3-photo bundle allocation…
    await createCheckoutSessionAction();
    expect((await storedAllocations(talent.id)).reduce<number>((s, c) => s + (c ?? 0), 0)).toBe(
      1200,
    );

    // …then the buyer abandons it and removes a photo. The surviving rows must
    // NOT keep the discounted share, or a 2-photo cart would be charged as if it
    // were still a bundle.
    await removePhotoFromCartAction(photos[0].id);
    await createCheckoutSessionAction();

    expect(photoTotal()).toBe(1000);
    expect(await storedAllocations(talent.id)).toEqual([null, null]);
  });

  it('charges one service-fee line item on the DISCOUNTED subtotal', async () => {
    feeMock.fixed = 25;
    feeMock.bps = 300;
    await seedTalentCart(3);

    await createCheckoutSessionAction();

    expect(feeLineItems()).toHaveLength(1);
    expect(feeLineItems()[0].price_data.unit_amount).toBe(61);
  });

  it('reports the discount to the cart page from the same kernel', async () => {
    await seedTalentCart(3);

    const cart = await getCurrentCart();

    expect(cart.subtotalCents).toBe(1500);
    expect(cart.bundleDiscountCents).toBe(300);
    // 3 photos already reach the 3+ rung, so the nudge points at the 8+ one.
    expect(cart.nextTier).toMatchObject({ minQuantity: 8, resultingTotalCents: 2000 });
  });

  it('excludes an already-purchased photo from the threshold', async () => {
    // A purchased photo is not addable to the cart at all (the cart is the only
    // thing bundle pricing sees), so a buyer who owns one of three photos has a
    // two-photo cart and gets no discount.
    const { photos, talent } = await seedTalentCart(3);
    await removePhotoFromCartAction(photos[0].id);

    const cart = await getCurrentCart();

    expect(cart.itemCount).toBe(2);
    expect(cart.bundleDiscountCents).toBe(0);
    await createCheckoutSessionAction();
    expect(photoTotal()).toBe(1000);
    expect(await storedAllocations(talent.id)).toEqual([null, null]);
  });
});

describe('organizer and free events are excluded', () => {
  it('charges list price on an organizer event even with a stored ladder', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    await markConnected(photographer.id);
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    await createServiceClient()
      .from('events')
      .update({ type: 'organizer', bundle_tiers: LADDER })
      .eq('id', event.id);
    const photos = [];
    for (let i = 0; i < 3; i++) {
      photos.push(await createTestPhoto(event.id, { user_id: photographer.id }));
    }

    await createGuestCheckoutSessionAction(
      photos.map((p) => guestItem(p.id, photographer.id, event.id)),
    );

    // An organizer event can span several sellers and has no revenue split to
    // charge a discount against, so the ladder must not be read.
    expect(photoTotal()).toBe(1500);
  });
});
