/**
 * Integration tests for the webhook's half of the withdrawal-consent gate
 * (T-228).
 *
 * Two properties, pulling in opposite directions and both load-bearing:
 *
 *  1. When the session carries the consent, it lands on the order row. That row
 *     is the only evidence the art. 16(m) exemption ever applied, so losing it
 *     silently would leave the "no refunds" policy unenforceable exactly when
 *     it is challenged.
 *  2. When it does not, the order is STILL created, with NULL columns. Sessions
 *     created before this shipped carry no consent and the buyer has already
 *     paid — failing closed there would withhold photos someone was charged
 *     for, which is a worse outcome than an incomplete record.
 *
 * Also pinned: the signed-in buyer now gets a purchase confirmation at all
 * (art. 8.7), which before T-228 only guests received.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/stripe/connect', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/stripe/connect')>('@/lib/stripe/connect');
  return {
    ...actual,
    createTransfer: vi.fn(async () => ({ id: 'tr_test_mock' }) as unknown),
    reconcileAndPersistConnectStatus: vi.fn(
      async (params: { storedStatus: string }) => params.storedStatus,
    ),
  };
});

vi.mock('@/lib/email/send-guest-purchase-email', () => ({
  sendGuestPurchaseEmail: vi.fn(async () => undefined),
}));

vi.mock('@/lib/email/send-purchase-confirmation-email', () => ({
  sendPurchaseConfirmationEmail: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

import Stripe from 'stripe';
import { POST } from '@/app/api/stripe/webhook/route';
import { sendGuestPurchaseEmail } from '@/lib/email/send-guest-purchase-email';
import { sendPurchaseConfirmationEmail } from '@/lib/email/send-purchase-confirmation-email';
import {
  WITHDRAWAL_CONSENT_AT_KEY,
  WITHDRAWAL_CONSENT_VERSION_KEY,
} from '@/lib/withdrawal-consent';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const WEBHOOK_SECRET = 'whsec_test_dummy_for_tests_at_least_32_chars';
const CONSENT_AT = '2026-08-05T09:15:00.000Z';
const CONSENT_VERSION = '2026-08-05';

const CONSENT_METADATA = {
  [WITHDRAWAL_CONSENT_AT_KEY]: CONSENT_AT,
  [WITHDRAWAL_CONSENT_VERSION_KEY]: CONSENT_VERSION,
};

function signedWebhookRequest(event: object): Request {
  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2026-06-24.dahlia' });
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

async function seedTalentCart() {
  const sb = createServiceClient();
  const photographer = await createTestUser('PHOTOGRAPHER');
  await sb
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
  const talent = await createTestUser('TALENT');

  const { data: cart } = await sb
    .from('carts')
    .insert({ user_id: talent.id })
    .select('id')
    .single();
  if (!cart) throw new Error('cart seed failed');

  const photo = await createTestPhoto(event.id, { user_id: photographer.id });
  await sb.from('cart_items').insert({
    cart_id: cart.id,
    photo_id: photo.id,
    photographer_id: photographer.id,
    unit_price_cents: 500,
  });

  return { cartId: cart.id, talentId: talent.id };
}

function authedCheckoutRequest(opts: {
  sessionId: string;
  userId: string;
  cartId: string;
  consent: boolean;
}) {
  return signedWebhookRequest({
    id: `evt_${opts.sessionId}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.sessionId,
        object: 'checkout.session',
        mode: 'payment',
        client_reference_id: opts.cartId,
        customer: null,
        customer_details: { email: 'buyer@example.com' },
        payment_intent: `pi_${opts.sessionId}`,
        amount_total: 500,
        currency: 'eur',
        metadata: {
          user_id: opts.userId,
          cart_id: opts.cartId,
          ...(opts.consent ? CONSENT_METADATA : {}),
        },
      },
    },
  });
}

async function seedGuestPhoto() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
  const photo = await createTestPhoto(event.id, { user_id: photographer.id });
  return { photographerId: photographer.id, photoId: photo.id };
}

function guestCheckoutRequest(opts: {
  sessionId: string;
  photoId: string;
  photographerId: string;
  consent: boolean;
}) {
  return signedWebhookRequest({
    id: `evt_${opts.sessionId}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_intent: null,
        customer: null,
        customer_details: { email: 'guest@example.com' },
        amount_total: 500,
        currency: 'eur',
        metadata: {
          is_guest: 'true',
          cart_count: '1',
          cart_0: JSON.stringify({ p: opts.photoId, g: opts.photographerId, c: 500 }),
          ...(opts.consent ? CONSENT_METADATA : {}),
        },
      },
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

describe('webhook — authenticated order consent', () => {
  it('persists the consent from the session metadata', async () => {
    const sb = createServiceClient();
    const { cartId, talentId } = await seedTalentCart();

    const res = await POST(
      authedCheckoutRequest({
        sessionId: 'cs_consent_yes',
        userId: talentId,
        cartId,
        consent: true,
      }),
    );
    expect(res.status).toBe(200);

    const { data: order } = await sb
      .from('orders')
      .select('withdrawal_consent_at, withdrawal_consent_version')
      .eq('stripe_checkout_session_id', 'cs_consent_yes')
      .single();

    expect(new Date(order!.withdrawal_consent_at as string).toISOString()).toBe(CONSENT_AT);
    expect(order?.withdrawal_consent_version).toBe(CONSENT_VERSION);
  });

  it('still creates the order when no consent is on the session (fails open)', async () => {
    const sb = createServiceClient();
    const { cartId, talentId } = await seedTalentCart();

    const res = await POST(
      authedCheckoutRequest({
        sessionId: 'cs_consent_no',
        userId: talentId,
        cartId,
        consent: false,
      }),
    );
    expect(res.status).toBe(200);

    const { data: order } = await sb
      .from('orders')
      .select('id, total_amount_cents, withdrawal_consent_at, withdrawal_consent_version')
      .eq('stripe_checkout_session_id', 'cs_consent_no')
      .single();

    // The buyer already paid: the order exists and is deliverable.
    expect(order?.total_amount_cents).toBe(500);
    expect(order?.withdrawal_consent_at).toBeNull();
    expect(order?.withdrawal_consent_version).toBeNull();
  });

  it('sends the signed-in buyer a confirmation carrying the consent (art. 8.7)', async () => {
    const { cartId, talentId } = await seedTalentCart();

    await POST(
      authedCheckoutRequest({
        sessionId: 'cs_consent_email',
        userId: talentId,
        cartId,
        consent: true,
      }),
    );

    expect(vi.mocked(sendPurchaseConfirmationEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendPurchaseConfirmationEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        photoCount: 1,
        withdrawalConsent: { acceptedAt: CONSENT_AT, version: CONSENT_VERSION },
      }),
    );
  });
});

describe('webhook — guest order consent', () => {
  it('persists the consent and passes it to the confirmation email', async () => {
    const sb = createServiceClient();
    const { photoId, photographerId } = await seedGuestPhoto();

    const res = await POST(
      guestCheckoutRequest({
        sessionId: 'cs_guest_consent',
        photoId,
        photographerId,
        consent: true,
      }),
    );
    expect(res.status).toBe(200);

    const { data: order } = await sb
      .from('guest_orders')
      .select('withdrawal_consent_at, withdrawal_consent_version')
      .eq('stripe_checkout_session_id', 'cs_guest_consent')
      .single();

    expect(new Date(order!.withdrawal_consent_at as string).toISOString()).toBe(CONSENT_AT);
    expect(order?.withdrawal_consent_version).toBe(CONSENT_VERSION);

    expect(vi.mocked(sendGuestPurchaseEmail)).toHaveBeenCalledWith(
      expect.objectContaining({
        withdrawalConsent: { acceptedAt: CONSENT_AT, version: CONSENT_VERSION },
      }),
    );
  });

  it('still creates the guest order when no consent is on the session (fails open)', async () => {
    const sb = createServiceClient();
    const { photoId, photographerId } = await seedGuestPhoto();

    const res = await POST(
      guestCheckoutRequest({
        sessionId: 'cs_guest_no_consent',
        photoId,
        photographerId,
        consent: false,
      }),
    );
    expect(res.status).toBe(200);

    const { data: order } = await sb
      .from('guest_orders')
      .select('total_amount_cents, withdrawal_consent_at, withdrawal_consent_version')
      .eq('stripe_checkout_session_id', 'cs_guest_no_consent')
      .single();

    expect(order?.total_amount_cents).toBe(500);
    expect(order?.withdrawal_consent_at).toBeNull();
    expect(order?.withdrawal_consent_version).toBeNull();
  });
});
