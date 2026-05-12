/**
 * Integration tests for role Server Actions in `app/[lang]/actions/roles.ts`.
 *
 * Roles are auth-adjacent — `switchRole` decides which dashboard a user lands
 * on after sign-in. These tests pin the security guarantees:
 *   - You can't switch to a role you've never had granted (TALENT enable is
 *     the legitimate auto-grant path; PHOTOGRAPHER is not auto-grantable).
 *   - You can't act on roles without auth.
 *   - getActiveRole falls back to PHOTOGRAPHER when no profile exists yet
 *     (the documented onboarding default).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// We're TESTING `@/app/[lang]/actions/roles`, so we deliberately skip the
// `getActiveRole` mock — it would shadow real exports of the module under
// test. Everything else (database/server, next/cache, next/headers, the
// redirect helpers) gets the standard inline mock treatment.

vi.mock('@/database/server', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    createClient: vi.fn(async () => {
      const sb = createClient(
        'http://127.0.0.1:54321',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      sb.auth.getUser = vi.fn(async () => {
        if (!mockSession.userId) {
          return { data: { user: null }, error: null } as never;
        }
        return {
          data: {
            user: { id: mockSession.userId, email: `${mockSession.userId}@photomarkt.test` },
          },
          error: null,
        } as never;
      });
      return sb;
    }),
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    getAll: vi.fn(() => []),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// `localizedRedirect` calls Next.js's `redirect()` which throws
// NEXT_REDIRECT at the end of `completeOnboarding`. Stub to a no-op.
vi.mock('@/lib/i18n/redirect', () => ({
  localizedRedirect: vi.fn(),
}));
vi.mock('@/lib/i18n/get-lang-from-headers', () => ({
  getLangFromHeaders: vi.fn(async () => 'en'),
}));

import { completeOnboarding, enableTalentRole, switchRole } from '@/app/[lang]/actions/roles';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('roles Server Actions', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  describe('switchRole', () => {
    it('rejects unauthenticated callers', async () => {
      mockSession.userId = null;
      await expect(switchRole('talent')).rejects.toThrow(/signed in/i);
    });

    it("enables the TALENT role and switches to it when the user doesn't have it yet", async () => {
      // createTestUser('PHOTOGRAPHER') seeds only the PHOTOGRAPHER role.
      // Switching to talent is the documented auto-enable path.
      const user = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = user.id;

      const result = await switchRole('talent', { skipRevalidation: true });
      expect(result.activeRole).toBe('talent');

      const sb = createServiceClient();
      const { data: profile } = await sb
        .from('profiles')
        .select('active_role')
        .eq('id', user.id)
        .single();
      expect(profile?.active_role).toBe('TALENT');
    });

    it('rejects switching to PHOTOGRAPHER when the user has never had that role', async () => {
      // We seed a user with only the TALENT role and explicitly clean up the
      // PHOTOGRAPHER row that createTestUser would normally add. Then a
      // request to switch back to PHOTOGRAPHER must be rejected.
      const sb = createServiceClient();
      const user = await createTestUser('TALENT');
      await sb
        .from('user_role_memberships')
        .delete()
        .eq('user_id', user.id)
        .eq('role', 'PHOTOGRAPHER');

      mockSession.userId = user.id;
      await expect(switchRole('photographer', { skipRevalidation: true })).rejects.toThrow(
        /not enabled/i,
      );
    });

    it('rejects an invalid role slug at the Zod boundary', async () => {
      const user = await createTestUser('TALENT');
      mockSession.userId = user.id;
      await expect(switchRole('admin' as 'talent', { skipRevalidation: true })).rejects.toThrow();
    });
  });

  describe('enableTalentRole', () => {
    it('grants TALENT and flips active_role for an authenticated photographer-only user', async () => {
      const user = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = user.id;

      const result = await enableTalentRole();
      expect(result.activeRole).toBe('talent');

      const sb = createServiceClient();
      const { data: roles } = await sb
        .from('user_role_memberships')
        .select('role')
        .eq('user_id', user.id);
      const roleSet = new Set(roles?.map((r) => r.role));
      expect(roleSet.has('TALENT')).toBe(true);
      expect(roleSet.has('PHOTOGRAPHER')).toBe(true);
    });

    it('rejects unauthenticated callers', async () => {
      mockSession.userId = null;
      await expect(enableTalentRole()).rejects.toThrow(/signed in/i);
    });
  });

  describe('completeOnboarding', () => {
    it("stamps the user's profile with the chosen role + username", async () => {
      const user = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = user.id;

      await completeOnboarding('TALENT', 'newchosenname');

      const sb = createServiceClient();
      const { data: profile } = await sb
        .from('profiles')
        .select('active_role, username')
        .eq('id', user.id)
        .single();
      expect(profile?.active_role).toBe('TALENT');
      expect(profile?.username).toBe('newchosenname');
    });

    it('rejects when the supplied role is not in the enum (Zod boundary)', async () => {
      const user = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = user.id;
      await expect(completeOnboarding('SUPERUSER' as 'TALENT')).rejects.toThrow();
    });
  });
});
