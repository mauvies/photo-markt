/**
 * Integration tests for `database/queries/profiles.ts`.
 *
 * Profile reads sit behind nearly every dashboard render. These tests cover
 * the small, frequently-called accessors first; role + Stripe Connect
 * helpers second.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getProfile,
  getProfileActiveRole,
  getProfileFields,
  getProfileStripeConnect,
  updateProfile,
  updateProfileStripeConnect,
} from '@/database/queries/profiles';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/profiles', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getProfile', () => {
    it('returns the profile row for an existing user', async () => {
      const user = await createTestUser('TALENT', { username: 'alice_t', display_name: 'Alice' });
      const profile = await getProfile(createServiceClient(), user.id);
      expect(profile?.id).toBe(user.id);
      expect(profile?.username).toBe('alice_t');
      expect(profile?.display_name).toBe('Alice');
    });

    it('returns null when the user has no profile row', async () => {
      const found = await getProfile(createServiceClient(), '00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('getProfileFields', () => {
    it('returns only the requested columns', async () => {
      const user = await createTestUser('PHOTOGRAPHER', { username: 'bob_p' });
      const fields = await getProfileFields(createServiceClient(), user.id, [
        'username',
        'active_role',
      ]);
      expect(fields?.username).toBe('bob_p');
      expect(fields?.active_role).toBe('PHOTOGRAPHER');
      // bio is not in the selection — accessing it would be undefined.
      expect((fields as Record<string, unknown>).bio).toBeUndefined();
    });

    it('returns null for an unknown user', async () => {
      const fields = await getProfileFields(
        createServiceClient(),
        '00000000-0000-0000-0000-000000000000',
        ['username'],
      );
      expect(fields).toBeNull();
    });
  });

  describe('getProfileActiveRole', () => {
    it('returns the role enum value as stored', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      expect(await getProfileActiveRole(sb, photographer.id)).toBe('PHOTOGRAPHER');
      expect(await getProfileActiveRole(sb, talent.id)).toBe('TALENT');
    });

    it('returns null when no profile exists', async () => {
      expect(
        await getProfileActiveRole(createServiceClient(), '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('updates only the supplied columns', async () => {
      const user = await createTestUser('PHOTOGRAPHER', { display_name: 'Original' });
      const sb = createServiceClient();
      await updateProfile(sb, user.id, { display_name: 'Updated', bio: 'Hello' });

      const after = await getProfile(sb, user.id);
      expect(after?.display_name).toBe('Updated');
      expect(after?.bio).toBe('Hello');
    });
  });

  describe('Stripe Connect helpers', () => {
    it('updateProfileStripeConnect persists account id + status', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      await updateProfileStripeConnect(sb, photographer.id, {
        stripe_connect_account_id: 'acct_test123',
        stripe_connect_status: 'active',
      });

      const status = await getProfileStripeConnect(sb, photographer.id);
      expect(status?.stripe_connect_account_id).toBe('acct_test123');
      expect(status?.stripe_connect_status).toBe('active');
    });

    it("getProfileStripeConnect returns 'not_connected' when nothing has been set", async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const status = await getProfileStripeConnect(createServiceClient(), photographer.id);
      expect(status?.stripe_connect_status).toBe('not_connected');
      expect(status?.stripe_connect_account_id).toBeNull();
    });
  });
});
