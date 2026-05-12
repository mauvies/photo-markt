import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPaymentAccount,
  deletePaymentAccount,
  getDefaultPaymentAccount,
  getPaymentAccount,
  getPaymentAccounts,
  setDefaultPaymentAccount,
  updatePaymentAccount,
} from '@/database/queries/payment-accounts';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/payment-accounts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('createPaymentAccount + getPaymentAccount', () => {
    it('inserts and reads back', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const created = await createPaymentAccount(sb, photographer.id, {
        type: 'bank_account',
        display_name: 'Primary',
        account_holder_name: 'Photo Markt',
        account_details: { iban: 'ES7621000418401234567891', country_code: 'ES' },
        is_default: true,
      });

      const found = await getPaymentAccount(sb, created.id, photographer.id);
      expect(found?.display_name).toBe('Primary');
      expect(found?.is_default).toBe(true);
    });

    it('returns null when another photographer asks', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const created = await createPaymentAccount(sb, photographer.id, {
        type: 'bank_account',
        display_name: 'Primary',
      });
      expect(await getPaymentAccount(sb, created.id, stranger.id)).toBeNull();
    });
  });

  describe('getPaymentAccounts', () => {
    it("returns only the requesting photographer's accounts", async () => {
      const a = await createTestUser('PHOTOGRAPHER');
      const b = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      await createPaymentAccount(sb, a.id, { type: 'paypal', display_name: 'A1' });
      await createPaymentAccount(sb, a.id, { type: 'wise', display_name: 'A2' });
      await createPaymentAccount(sb, b.id, { type: 'bank_account', display_name: 'B1' });

      const accounts = await getPaymentAccounts(sb, a.id);
      expect(accounts).toHaveLength(2);
      for (const acc of accounts) expect(acc.photographer_id).toBe(a.id);
    });
  });

  describe('default-account semantics', () => {
    it('createPaymentAccount with is_default: true marks the row as default', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const created = await createPaymentAccount(sb, photographer.id, {
        type: 'paypal',
        display_name: 'PayPal',
        is_default: true,
      });
      const def = await getDefaultPaymentAccount(sb, photographer.id);
      expect(def?.id).toBe(created.id);
    });

    it('without is_default, the row is created non-default (getDefault returns null)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      await createPaymentAccount(sb, photographer.id, { type: 'paypal', display_name: 'PayPal' });
      expect(await getDefaultPaymentAccount(sb, photographer.id)).toBeNull();
    });

    it('setDefaultPaymentAccount flips the default exclusively (only one default at a time)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const a = await createPaymentAccount(sb, photographer.id, {
        type: 'paypal',
        display_name: 'A',
      });
      const b = await createPaymentAccount(sb, photographer.id, {
        type: 'wise',
        display_name: 'B',
      });

      await setDefaultPaymentAccount(sb, b.id, photographer.id);
      const def = await getDefaultPaymentAccount(sb, photographer.id);
      expect(def?.id).toBe(b.id);

      // a should no longer be default — verify by re-fetching.
      const aAfter = await getPaymentAccount(sb, a.id, photographer.id);
      expect(aAfter?.is_default).toBe(false);
    });
  });

  describe('updatePaymentAccount + deletePaymentAccount', () => {
    it('updates the supplied fields', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const created = await createPaymentAccount(sb, photographer.id, {
        type: 'paypal',
        display_name: 'Original',
      });
      await updatePaymentAccount(sb, created.id, photographer.id, { display_name: 'Renamed' });
      const after = await getPaymentAccount(sb, created.id, photographer.id);
      expect(after?.display_name).toBe('Renamed');
    });

    it('deletes the row', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const created = await createPaymentAccount(sb, photographer.id, {
        type: 'paypal',
        display_name: 'X',
      });
      await deletePaymentAccount(sb, created.id, photographer.id);
      expect(await getPaymentAccount(sb, created.id, photographer.id)).toBeNull();
    });
  });
});
