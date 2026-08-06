/**
 * Integration tests for `database/queries/user-roles.ts`.
 *
 * T-235 (found while executing T-234): `getUserRole` used `.maybeSingle()` on
 * `user_role_memberships`, which holds **one row per role**. A user holding
 * both roles therefore had two rows, and `maybeSingle()` rejects "more than one
 * row" with the same opaque `PGRST116` it uses for "no rows" — so the onboarding
 * gate, whose only question is "has this user finished onboarding?", threw for
 * precisely the users who most clearly had.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getUserRole, getUserRoles, upsertUserRole } from '@/database/queries/user-roles';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/user-roles', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getUserRole', () => {
    it('returns the role a single-role user holds', async () => {
      const user = await createTestUser('TALENT');
      const sb = createServiceClient();
      await sb
        .from('user_role_memberships')
        .delete()
        .eq('user_id', user.id)
        .eq('role', 'PHOTOGRAPHER');

      expect(await getUserRole(sb, user.id)).toBe('TALENT');
    });

    it('returns a role — not an error — for a user holding BOTH roles', async () => {
      // The regression. Two membership rows used to make `maybeSingle()` throw.
      const user = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      await upsertUserRole(sb, user.id, 'TALENT');
      expect((await getUserRoles(sb, user.id)).sort()).toEqual(['PHOTOGRAPHER', 'TALENT']);

      // Callers only ask "does this user hold any role?", so *which* one comes
      // back is unspecified — that it answers at all is the contract.
      expect(['PHOTOGRAPHER', 'TALENT']).toContain(await getUserRole(sb, user.id));
    });

    it('returns null for a user with no membership at all', async () => {
      const user = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      await sb.from('user_role_memberships').delete().eq('user_id', user.id);

      expect(await getUserRole(sb, user.id)).toBeNull();
    });
  });
});
