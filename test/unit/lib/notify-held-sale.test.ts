/**
 * Unit tests for `notifyPhotographerOfHeldSale` (T-250).
 *
 * T-248 stopped refusing a sale from a photographer without an active payout
 * account: the buyer is charged and the photographer's net is parked as a
 * `connect_inactive` hold. Every warning about that state is in-app — and the
 * photographer it concerns is, by definition, the one who has not finished
 * onboarding, so they are the least likely to be looking at a dashboard.
 *
 * Three properties are pinned here, and two of them are negative:
 *   1. it NEVER throws — the buyer has already paid, and a 500 makes Stripe
 *      redeliver a money event;
 *   2. it does not spam — 40 sold photos must not be 40 emails;
 *   3. it carries no buyer PII (only the photographer's own address and their
 *      own held total).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { countHolds, getTotalPending, sendHeldSaleEmail, env } = vi.hoisted(() => ({
  countHolds: vi.fn(async (): Promise<number> => 1),
  getTotalPending: vi.fn(async (): Promise<number> => 460),
  sendHeldSaleEmail: vi.fn(
    async (_payload: { to: string; heldAmount: string; payoutSettingsUrl: string }) => undefined,
  ),
  env: { SITE_URL: 'https://photomarkt.test' },
}));

vi.mock('@/database/queries/payouts', () => ({
  countOutstandingConnectInactiveHolds: countHolds,
  getTotalPendingPayouts: getTotalPending,
}));
vi.mock('@/lib/email/send-held-sale-email', () => ({ sendHeldSaleEmail }));
vi.mock('@/env.mjs', () => ({ env }));

import { notifyPhotographerOfHeldSale } from '@/lib/payouts/notify-held-sale';

const PHOTOGRAPHER = 'ph_1';

/** Minimal stand-in for the service-role client — only the RPC is used. */
function clientWithEmail(email: string | null, error: unknown = null) {
  return {
    rpc: vi.fn(async () => ({
      data: email ? [{ user_id: PHOTOGRAPHER, email }] : [],
      error,
    })),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  countHolds.mockResolvedValue(1);
  getTotalPending.mockResolvedValue(460);
});

describe('notifyPhotographerOfHeldSale', () => {
  it('emails the photographer when this sale starts the holding streak', async () => {
    const outcome = await notifyPhotographerOfHeldSale(
      clientWithEmail('shooter@example.com'),
      PHOTOGRAPHER,
    );

    expect(outcome).toBe('sent');
    expect(sendHeldSaleEmail).toHaveBeenCalledTimes(1);
    const [payload] = sendHeldSaleEmail.mock.calls[0];
    expect(payload.to).toBe('shooter@example.com');
    // The amount is the same figure the dashboard quotes (`getTotalPendingPayouts`).
    expect(payload.heldAmount).toContain('4.60');
    // Locale-less link: the proxy resolves the reader's own language.
    expect(payload.payoutSettingsUrl).toBe(
      'https://photomarkt.test/dashboard/photographer/settings/payout-profile',
    );
  });

  it('stays silent when they are already in a holding streak', async () => {
    // 40 photos sold while disconnected must not be 40 emails.
    countHolds.mockResolvedValue(7);

    const outcome = await notifyPhotographerOfHeldSale(
      clientWithEmail('shooter@example.com'),
      PHOTOGRAPHER,
    );

    expect(outcome).toBe('skipped_already_notified');
    expect(sendHeldSaleEmail).not.toHaveBeenCalled();
  });

  it('never throws when Resend refuses the message', async () => {
    sendHeldSaleEmail.mockRejectedValueOnce(new Error('Resend rejected the held sale email'));

    await expect(
      notifyPhotographerOfHeldSale(clientWithEmail('shooter@example.com'), PHOTOGRAPHER),
    ).resolves.toBe('failed');
  });

  it('never throws when the ledger read fails', async () => {
    countHolds.mockRejectedValueOnce(new Error('db down'));

    await expect(
      notifyPhotographerOfHeldSale(clientWithEmail('shooter@example.com'), PHOTOGRAPHER),
    ).resolves.toBe('failed');
  });

  it('gives up quietly when the account has no resolvable address', async () => {
    const outcome = await notifyPhotographerOfHeldSale(clientWithEmail(null), PHOTOGRAPHER);

    expect(outcome).toBe('skipped_no_email');
    expect(sendHeldSaleEmail).not.toHaveBeenCalled();
  });

  it('carries nothing about the buyer', async () => {
    await notifyPhotographerOfHeldSale(clientWithEmail('shooter@example.com'), PHOTOGRAPHER);

    const [payload] = sendHeldSaleEmail.mock.calls[0];
    // The whole payload is the photographer's own address, their own held
    // total, and a link. Nothing identifies who bought or what.
    expect(Object.keys(payload).sort()).toEqual(['heldAmount', 'payoutSettingsUrl', 'to']);
  });
});
