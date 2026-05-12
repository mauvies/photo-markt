import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPayout,
  createPayoutFromTransfer,
  getPayout,
  getPayouts,
  getTotalPaidOut,
  getTotalPendingPayouts,
  updatePayoutStatus,
} from '@/database/queries/payouts';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/payouts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('createPayout + getPayout + getPayouts', () => {
    it('createPayout inserts a pending row and getPayout finds it', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      // payment_account is required by FK — seed one first.
      const { data: account } = await sb
        .from('payment_accounts')
        .insert({
          photographer_id: photographer.id,
          type: 'bank_account',
          display_name: 'Test',
        })
        .select('id')
        .single();
      if (!account) throw new Error('seed account failed');

      const created = await createPayout(sb, photographer.id, 1500, account.id);
      expect(created.status).toBe('pending');
      expect(created.amount_cents).toBe(1500);

      const found = await getPayout(sb, created.id, photographer.id);
      expect(found?.id).toBe(created.id);
    });

    it('getPayout returns null when another photographer asks', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const { data: account } = await sb
        .from('payment_accounts')
        .insert({ photographer_id: photographer.id, type: 'bank_account', display_name: 'T' })
        .select('id')
        .single();
      const created = await createPayout(sb, photographer.id, 100, account!.id);
      expect(await getPayout(sb, created.id, stranger.id)).toBeNull();
    });

    it("getPayouts returns only the photographer's rows", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const { data: a } = await sb
        .from('payment_accounts')
        .insert({ photographer_id: photographer.id, type: 'bank_account', display_name: 'A' })
        .select('id')
        .single();
      const { data: b } = await sb
        .from('payment_accounts')
        .insert({ photographer_id: stranger.id, type: 'bank_account', display_name: 'B' })
        .select('id')
        .single();
      await createPayout(sb, photographer.id, 100, a!.id);
      await createPayout(sb, photographer.id, 200, a!.id);
      await createPayout(sb, stranger.id, 300, b!.id);

      const mine = await getPayouts(sb, photographer.id);
      expect(mine).toHaveLength(2);
      for (const p of mine) expect(p.photographer_id).toBe(photographer.id);
    });

    it('getPayouts filters by status when provided', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const { data: account } = await sb
        .from('payment_accounts')
        .insert({ photographer_id: photographer.id, type: 'bank_account', display_name: 'X' })
        .select('id')
        .single();
      await createPayout(sb, photographer.id, 100, account!.id);
      const second = await createPayout(sb, photographer.id, 200, account!.id);
      await updatePayoutStatus(sb, second.id, 'paid');

      const pending = await getPayouts(sb, photographer.id, 'pending');
      const paid = await getPayouts(sb, photographer.id, 'paid');
      expect(pending).toHaveLength(1);
      expect(paid).toHaveLength(1);
      expect(paid[0].id).toBe(second.id);
    });
  });

  describe('updatePayoutStatus', () => {
    it('flips the status and stores admin_notes', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const { data: account } = await sb
        .from('payment_accounts')
        .insert({ photographer_id: photographer.id, type: 'bank_account', display_name: 'X' })
        .select('id')
        .single();
      const created = await createPayout(sb, photographer.id, 500, account!.id);

      const updated = await updatePayoutStatus(sb, created.id, 'approved', 'looks good');
      expect(updated.status).toBe('approved');
      expect(updated.admin_notes).toBe('looks good');
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
      });

      const { data } = await sb
        .from('payouts')
        .select('status, amount_cents, stripe_transfer_id')
        .eq('stripe_transfer_id', 'tr_abc123')
        .single();
      expect(data?.status).toBe('paid');
      expect(data?.amount_cents).toBe(800);
    });

    it('is idempotent — second call with same transfer_id swallows the unique violation', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const args = {
        photographer_id: photographer.id,
        amount_cents: 800,
        stripe_transfer_id: 'tr_dup',
      };
      await createPayoutFromTransfer(sb, args);
      await expect(createPayoutFromTransfer(sb, args)).resolves.not.toThrow();
      const { count } = await sb
        .from('payouts')
        .select('*', { count: 'exact', head: true })
        .eq('stripe_transfer_id', 'tr_dup');
      expect(count).toBe(1);
    });
  });

  describe('totals helpers', () => {
    it('getTotalPaidOut sums only paid payouts', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const { data: account } = await sb
        .from('payment_accounts')
        .insert({ photographer_id: photographer.id, type: 'bank_account', display_name: 'X' })
        .select('id')
        .single();
      const a = await createPayout(sb, photographer.id, 100, account!.id);
      const b = await createPayout(sb, photographer.id, 200, account!.id);
      await createPayout(sb, photographer.id, 999, account!.id); // stays pending — must not count
      await updatePayoutStatus(sb, a.id, 'paid');
      await updatePayoutStatus(sb, b.id, 'paid');

      expect(await getTotalPaidOut(sb, photographer.id)).toBe(300);
    });

    it('getTotalPendingPayouts sums pending + approved', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const { data: account } = await sb
        .from('payment_accounts')
        .insert({ photographer_id: photographer.id, type: 'bank_account', display_name: 'X' })
        .select('id')
        .single();
      await createPayout(sb, photographer.id, 100, account!.id); // pending
      const b = await createPayout(sb, photographer.id, 200, account!.id);
      await updatePayoutStatus(sb, b.id, 'approved');
      const c = await createPayout(sb, photographer.id, 999, account!.id);
      await updatePayoutStatus(sb, c.id, 'paid'); // paid → excluded

      expect(await getTotalPendingPayouts(sb, photographer.id)).toBe(100 + 200);
    });
  });
});
