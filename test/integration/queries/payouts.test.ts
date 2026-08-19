import { beforeEach, describe, expect, it } from 'vitest';
import type { PayoutStatus } from '@/database/queries/payouts';
import {
  createPayoutFromTransfer,
  getPayout,
  getPayouts,
  getTotalPaidOut,
  getTotalPendingPayouts,
} from '@/database/queries/payouts';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/**
 * ⚠️ Fixtures insert directly rather than through a helper (T-220).
 *
 * `createPayout` used to seed these rows, and it was deleted with the manual
 * approval flow: it wrote `pending` with no charge id and no hold reason —
 * exactly the shape T-216 had to quarantine — and it was the last writer of the
 * legacy `payment_accounts.id`, which is why these tests used to seed that table
 * too. The rows below are still that legacy shape on purpose: these helpers must
 * keep reading pre-ledger rows correctly, since real ones exist in production.
 */
async function seedPayout(
  sb: ReturnType<typeof createServiceClient>,
  photographerId: string,
  amountCents: number,
  status: PayoutStatus = 'pending',
): Promise<{ id: string }> {
  const { data, error } = await sb
    .from('payouts')
    .insert({ photographer_id: photographerId, amount_cents: amountCents, status })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed payout failed: ${error?.message}`);
  return data as { id: string };
}

describe('database/queries/payouts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getPayout + getPayouts', () => {
    it('getPayout finds the photographer their own row', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();

      const created = await seedPayout(sb, photographer.id, 1500);

      const found = await getPayout(sb, created.id, photographer.id);
      expect(found?.id).toBe(created.id);
      expect(found?.amount_cents).toBe(1500);
    });

    it('getPayout returns null when another photographer asks', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();

      const created = await seedPayout(sb, photographer.id, 100);

      expect(await getPayout(sb, created.id, stranger.id)).toBeNull();
    });

    it("getPayouts returns only the photographer's rows", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();

      await seedPayout(sb, photographer.id, 100);
      await seedPayout(sb, photographer.id, 200);
      await seedPayout(sb, stranger.id, 300);

      const mine = await getPayouts(sb, photographer.id);
      expect(mine).toHaveLength(2);
      expect(mine.every((p) => p.photographer_id === photographer.id)).toBe(true);
    });

    it('getPayouts filters by status when provided', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();

      await seedPayout(sb, photographer.id, 100, 'pending');
      await seedPayout(sb, photographer.id, 200, 'paid');

      const pending = await getPayouts(sb, photographer.id, 'pending');
      const paid = await getPayouts(sb, photographer.id, 'paid');
      expect(pending).toHaveLength(1);
      expect(pending[0]?.amount_cents).toBe(100);
      expect(paid).toHaveLength(1);
      expect(paid[0]?.amount_cents).toBe(200);
    });
  });

  describe('createPayoutFromTransfer', () => {
    it('inserts a paid payout tied to a Stripe transfer id', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      await createPayoutFromTransfer(sb, {
        photographer_id: photographer.id,
        amount_cents: 800,
        stripe_transfer_id: 'tr_abc123',
        stripe_charge_id: 'ch_abc123',
        currency: 'eur',
      });

      const { data } = await sb
        .from('payouts')
        .select('status, amount_cents, stripe_transfer_id, stripe_charge_id')
        .eq('stripe_transfer_id', 'tr_abc123')
        .single();
      expect(data?.status).toBe('paid');
      expect(data?.amount_cents).toBe(800);
      expect(data?.stripe_charge_id).toBe('ch_abc123');
    });

    // T-216 moved the uniqueness from `stripe_transfer_id` to
    // `(stripe_charge_id, photographer_id)`, because one aggregated transfer now
    // legitimately settles several rows. The dedupe still holds — but note it no
    // longer keys on the transfer id, so a second call with a DIFFERENT transfer
    // id for the same charge is also collapsed. That is the point: it means we
    // paid twice, and the row must not be duplicated to hide it.
    it('does not write a second row for the same (charge, photographer)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const args = {
        photographer_id: photographer.id,
        amount_cents: 800,
        stripe_transfer_id: 'tr_dup',
        stripe_charge_id: 'ch_dup',
        currency: 'eur',
      };
      await createPayoutFromTransfer(sb, args);
      await expect(
        createPayoutFromTransfer(sb, { ...args, stripe_transfer_id: 'tr_dup_second' }),
      ).resolves.not.toThrow();

      const { count } = await sb
        .from('payouts')
        .select('*', { count: 'exact', head: true })
        .eq('stripe_charge_id', 'ch_dup');
      expect(count).toBe(1);
    });
  });

  describe('totals helpers', () => {
    it('getTotalPaidOut sums only paid payouts', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();

      await seedPayout(sb, photographer.id, 100, 'paid');
      await seedPayout(sb, photographer.id, 200, 'paid');
      await seedPayout(sb, photographer.id, 999, 'pending'); // must not count

      expect(await getTotalPaidOut(sb, photographer.id)).toBe(300);
    });

    it('getTotalPendingPayouts sums pending + approved', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();

      // `approved` has no writer since T-216, but it is still read here on
      // purpose: a legacy row in that state is money that has not landed, and
      // counting it as withdrawable would overstate the balance.
      await seedPayout(sb, photographer.id, 100, 'pending');
      await seedPayout(sb, photographer.id, 200, 'approved');
      await seedPayout(sb, photographer.id, 999, 'paid'); // excluded

      expect(await getTotalPendingPayouts(sb, photographer.id)).toBe(100 + 200);
    });

    it('getTotalPendingPayouts counts money that is mid-transfer', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();

      // T-216: `processing` must be in the unlanded set, or the earnings
      // balance presents a transfer in flight as available to withdraw.
      await seedPayout(sb, photographer.id, 450, 'processing');

      expect(await getTotalPendingPayouts(sb, photographer.id)).toBe(450);
    });
  });
});
