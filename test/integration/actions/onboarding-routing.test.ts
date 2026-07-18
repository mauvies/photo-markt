/**
 * Integration tests for the onboarding-routing fix in
 * `app/[lang]/actions/roles.ts`.
 *
 * Core regression (Defect B): resolving the current user's active role must be
 * a pure read. Previously `getActiveRole()` created a profile with an
 * email-derived username and a default PHOTOGRAPHER role for a brand-new user,
 * which permanently bypassed onboarding. After the fix, resolving a role never
 * writes; `getActiveRoleOrNull()` reports `null` for a user who hasn't onboarded
 * so routing/gating can send them to `/onboarding/role`.
 *
 * The callback/login/dashboard redirect targets (Defect A + the dashboard gate)
 * branch on exactly this resolver result; route-handler/page rendering is
 * covered by typecheck + manual e2e (tasks.md 5.2), not exercised here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// We're TESTING `@/app/[lang]/actions/roles`, so we deliberately skip the
// `getActiveRole` mock. Everything else gets the standard inline mock treatment.

vi.mock('@/database/server', async () => {
  const { buildDatabaseServerMock } = await import('../../helpers/database-server-mock');
  const { mockSession } = await import('../../helpers/server-action-mocks');
  return buildDatabaseServerMock(mockSession);
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

vi.mock('@/lib/i18n/redirect', () => ({
  localizedRedirect: vi.fn(),
}));
vi.mock('@/lib/i18n/get-lang-from-headers', () => ({
  getLangFromHeaders: vi.fn(async () => 'en'),
}));

import { completeOnboarding, getActiveRole, getActiveRoleOrNull } from '@/app/[lang]/actions/roles';
import { localizedRedirect } from '@/lib/i18n/redirect';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Confirmed auth user WITHOUT a profile row — the real brand-new-user state. */
async function createAuthUserWithoutProfile(): Promise<{ id: string; email: string }> {
  const sb = createServiceClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `noprofile-${suffix}@photomarkt.test`;
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: 'test-password-1234',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createAuthUserWithoutProfile: ${error?.message ?? 'no user'}`);
  }
  await sb.from('profiles').delete().eq('id', data.user.id);
  return { id: data.user.id, email };
}

async function profileRow(userId: string) {
  const sb = createServiceClient();
  const { data } = await sb
    .from('profiles')
    .select('id, username, active_role')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

describe('onboarding routing', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
    // localizedRedirect is a module-level mock; clear call history so the
    // per-test redirect-target assertions below don't see prior tests' calls.
    vi.mocked(localizedRedirect).mockClear();
  });

  describe('getActiveRoleOrNull', () => {
    it('returns null for a user who has not onboarded (no profile row)', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      const role = await getActiveRoleOrNull();
      expect(role).toBeNull();
      // Reading the role must not have created a profile.
      expect(await profileRow(user.id)).toBeNull();
    });

    it('returns the stored role for an onboarded user without mutating the profile', async () => {
      const user = await createTestUser('TALENT', { username: 'jane_x' });
      mockSession.userId = user.id;

      const role = await getActiveRoleOrNull();
      expect(role).toBe('talent');

      const profile = await profileRow(user.id);
      expect(profile?.username).toBe('jane_x');
      expect(profile?.active_role).toBe('TALENT');
    });
  });

  describe('getActiveRole is side-effect-free (regression for Defect B)', () => {
    it('does NOT create a profile or an email-derived username for a roleless user', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      const { activeRole } = await getActiveRole();
      // It may report a default for display, but must not persist anything.
      expect(activeRole).toBe('photographer');
      expect(await profileRow(user.id)).toBeNull();
    });
  });

  describe('onboarding lifecycle end-to-end', () => {
    it('roleless → onboarding → chosen username persists (not email-derived)', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      // Before onboarding: gate resolves to null (→ would route to onboarding).
      expect(await getActiveRoleOrNull()).toBeNull();
      expect(await profileRow(user.id)).toBeNull();

      // Complete onboarding with a chosen role + username.
      await completeOnboarding('PHOTOGRAPHER', 'studio_lopez');

      // After onboarding: gate resolves to the chosen role, username preserved.
      expect(await getActiveRoleOrNull()).toBe('photographer');
      const profile = await profileRow(user.id);
      expect(profile?.active_role).toBe('PHOTOGRAPHER');
      expect(profile?.username).toBe('studio_lopez');
    });
  });

  describe('completeOnboarding preserves plan intent (T-148)', () => {
    it('redirects a new photographer with a PAID intent into the resume checkout route', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      await completeOnboarding('PHOTOGRAPHER', 'paid_pht', { plan: 'starter', period: 'yearly' });

      // The intent resumes into the server-validated checkout route (not the
      // bare dashboard) carrying the whitelisted plan + period.
      expect(vi.mocked(localizedRedirect)).toHaveBeenCalledWith(
        'en',
        '/dashboard/photographer/billing/resume?plan=starter&period=yearly',
      );
    });

    it('sends a new photographer with a FREE intent to the overview (no checkout)', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      await completeOnboarding('PHOTOGRAPHER', 'free_pht', { plan: 'free', period: 'monthly' });

      expect(vi.mocked(localizedRedirect)).toHaveBeenCalledWith('en', '/dashboard/photographer');
      // Never routes a Free intent through the checkout resume route.
      expect(vi.mocked(localizedRedirect)).not.toHaveBeenCalledWith(
        'en',
        expect.stringContaining('/billing/resume'),
      );
    });

    it('ignores a plan intent when onboarding as TALENT (a plan is photographer-only)', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      await completeOnboarding('TALENT', 'talent_x', { plan: 'starter', period: 'monthly' });

      expect(vi.mocked(localizedRedirect)).toHaveBeenCalledWith('en', '/dashboard/talent');
      expect(vi.mocked(localizedRedirect)).not.toHaveBeenCalledWith(
        'en',
        expect.stringContaining('/billing/resume'),
      );
    });

    it('with no intent, a photographer lands on the plain dashboard', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      await completeOnboarding('PHOTOGRAPHER', 'plain_pht');

      expect(vi.mocked(localizedRedirect)).toHaveBeenCalledWith('en', '/dashboard/photographer');
      expect(vi.mocked(localizedRedirect)).not.toHaveBeenCalledWith(
        'en',
        expect.stringContaining('/billing/resume'),
      );
    });
  });
});
