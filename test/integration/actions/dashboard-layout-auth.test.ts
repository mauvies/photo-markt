/**
 * Characterization + regression tests for the dashboard layouts' auth/role
 * gating and per-request auth round-trip count (T-095).
 *
 * The role gate is security: a signed-in user must land on onboarding when they
 * have no chosen role, and must be bounced from a dashboard whose role they do
 * not hold. These tests pin that behavior so the memoization refactor can't
 * silently regress it.
 *
 * The counter test pins the perf goal: a dashboard render must resolve the
 * user's auth context in ≤2 Supabase Auth round-trips (down from ~3 in the
 * layout alone before this change). In production React `cache()` collapses
 * these to a single round-trip; `cache()` is a no-op outside a request scope
 * (i.e. in vitest), so the observable floor here is 2, which is still the DoD
 * ceiling and — crucially — red on the pre-refactor 3-call layout.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// One shared spy for every `auth.getUser()` call, no matter which client
// instance issues it, so the test can count total auth round-trips per render.
const { authGetUser, localizedRedirect } = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  localizedRedirect: vi.fn(() => undefined),
}));

vi.mock('@/database/server', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const makeClient = () => {
    const sb = createClient(
      'http://127.0.0.1:54321',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    sb.auth.getUser = authGetUser;
    return sb;
  };
  return {
    createClient: vi.fn(async () => makeClient()),
    getUser: vi.fn(async () => {
      const { data } = await makeClient().auth.getUser();
      return data.user;
    }),
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock('@/lib/i18n/redirect', () => ({ localizedRedirect }));
vi.mock('@/lib/i18n/get-lang-from-headers', () => ({
  getLangFromHeaders: vi.fn(async () => 'en'),
}));
vi.mock('@/lib/i18n/get-dictionary', () => ({
  // The layouts only read nested label strings off the dictionary and pass them
  // to (unrendered) components — empty namespaces are enough.
  getDictionary: vi.fn(async () => ({
    dashboard: {},
    photographerDashboard: {},
    talentDashboard: {},
    nav: {},
  })),
}));

import PhotographerLayout from '@/app/[lang]/dashboard/photographer/layout';
import TalentLayout from '@/app/[lang]/dashboard/talent/layout';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('dashboard layout auth gating', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    localizedRedirect.mockClear();
    authGetUser.mockClear();
    authGetUser.mockImplementation(async () => {
      if (!mockSession.userId) {
        return { data: { user: null }, error: null };
      }
      return {
        data: {
          user: {
            id: mockSession.userId,
            email: `${mockSession.userId}@photomarkt.test`,
            user_metadata: {},
          },
        },
        error: null,
      };
    });
  });

  describe('role gating (characterization)', () => {
    it('redirects to onboarding when the user has no chosen role', async () => {
      const sb = createServiceClient();
      const user = await createTestUser('PHOTOGRAPHER');
      // No profile row ⇒ no active_role ⇒ "not onboarded yet".
      await sb.from('profiles').delete().eq('id', user.id);
      mockSession.userId = user.id;

      await PhotographerLayout({ children: null });

      expect(localizedRedirect).toHaveBeenCalledWith('en', '/onboarding/role');
    });

    it('redirects a talent-only user away from the photographer dashboard', async () => {
      const user = await createTestUser('TALENT');
      mockSession.userId = user.id;

      await PhotographerLayout({ children: null });

      expect(localizedRedirect).toHaveBeenCalledWith('en', '/dashboard');
    });

    it('lets a photographer into the photographer dashboard (no redirect)', async () => {
      const user = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = user.id;

      await PhotographerLayout({ children: null });

      expect(localizedRedirect).not.toHaveBeenCalled();
    });

    it('redirects a photographer-only user away from the talent dashboard', async () => {
      const sb = createServiceClient();
      const user = await createTestUser('PHOTOGRAPHER');
      // Ensure they only hold PHOTOGRAPHER (createTestUser seeds just that).
      await sb.from('user_role_memberships').delete().eq('user_id', user.id).eq('role', 'TALENT');
      mockSession.userId = user.id;

      await TalentLayout({ children: null });

      expect(localizedRedirect).toHaveBeenCalledWith('en', '/dashboard');
    });

    it('lets a talent into the talent dashboard (no redirect)', async () => {
      const user = await createTestUser('TALENT');
      mockSession.userId = user.id;

      await TalentLayout({ children: null });

      expect(localizedRedirect).not.toHaveBeenCalled();
    });
  });

  describe('auth round-trips per render (regression)', () => {
    it('resolves the photographer layout in ≤2 auth round-trips', async () => {
      const user = await createTestUser('PHOTOGRAPHER');
      mockSession.userId = user.id;

      authGetUser.mockClear();
      await PhotographerLayout({ children: null });

      // Pre-refactor the layout authenticated 3× (own getUser +
      // getActiveRoleOrNull + userHasRole). Now: one getUser() + one
      // getRoleContext() = 2 here, collapsing to 1 in production via cache().
      expect(authGetUser.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('resolves the talent layout in ≤2 auth round-trips', async () => {
      const user = await createTestUser('TALENT');
      mockSession.userId = user.id;

      authGetUser.mockClear();
      await TalentLayout({ children: null });

      expect(authGetUser.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });
});
