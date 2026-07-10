/**
 * Integration tests for the onboarding username flow in
 * `app/[lang]/actions/roles.ts` (`completeOnboarding`, `checkUsernameAvailability`).
 *
 * The core regression these pin: a brand-new user with NO profile row must
 * keep the username they chose during onboarding. The previous flow ran a
 * no-op UPDATE then let `upsertProfileRole` generate a username from the
 * user's email — silently discarding the chosen value.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSession } from '../../helpers/server-action-mocks';

// We're TESTING `@/app/[lang]/actions/roles`, so we deliberately skip the
// `getActiveRole` mock. Everything else (database/server, next/cache,
// next/headers, redirect helpers) gets the standard inline mock treatment.

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

// Success path ends in `localizedRedirect`, which throws NEXT_REDIRECT. Stub
// to a no-op so the action returns normally and we can assert DB state.
vi.mock('@/lib/i18n/redirect', () => ({
  localizedRedirect: vi.fn(),
}));
vi.mock('@/lib/i18n/get-lang-from-headers', () => ({
  getLangFromHeaders: vi.fn(async () => 'en'),
}));

import { checkUsernameAvailability, completeOnboarding } from '@/app/[lang]/actions/roles';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/**
 * Create a confirmed auth user WITHOUT a profile row — the real brand-new-user
 * state on the primary signup path. `createTestUser` always seeds a profile,
 * which would hide the regression, so we create the auth user directly.
 */
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
  // Defensive: drop any profile row a trigger might have created.
  await sb.from('profiles').delete().eq('id', data.user.id);
  return { id: data.user.id, email };
}

describe('onboarding username', () => {
  beforeEach(async () => {
    await resetDatabase();
    mockSession.userId = null;
    mockSession.activeRole = 'photographer';
  });

  describe('completeOnboarding persistence (regression)', () => {
    it('keeps the chosen username for a brand-new user with no profile row', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      const result = await completeOnboarding('TALENT', 'surfer_jane');
      expect(result).toBeUndefined();

      const sb = createServiceClient();
      const { data: profile } = await sb
        .from('profiles')
        .select('active_role, username')
        .eq('id', user.id)
        .single();
      expect(profile?.active_role).toBe('TALENT');
      // The chosen username must survive — NOT the email-derived fallback.
      expect(profile?.username).toBe('surfer_jane');
    });

    it('normalizes mixed-case and punctuation before persisting', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      await completeOnboarding('TALENT', 'Surfer Jane!');

      const sb = createServiceClient();
      const { data: profile } = await sb
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single();
      expect(profile?.username).toBe('surferjane');
    });
  });

  describe('uniqueness', () => {
    it('returns the "taken" outcome (no DB error) when another user owns the name', async () => {
      await createTestUser('TALENT', { username: 'taken_name' });
      const newUser = await createAuthUserWithoutProfile();
      mockSession.userId = newUser.id;

      const result = await completeOnboarding('TALENT', 'taken_name');
      expect(result).toEqual({ error: 'username_taken' });

      // Onboarding did not complete — no profile row was created.
      const sb = createServiceClient();
      const { data: profile } = await sb
        .from('profiles')
        .select('id')
        .eq('id', newUser.id)
        .maybeSingle();
      expect(profile).toBeNull();
    });

    it('lets a user keep their own current username (self-collision passes)', async () => {
      const user = await createTestUser('TALENT', { username: 'jane_x' });
      mockSession.userId = user.id;

      const result = await completeOnboarding('TALENT', 'jane_x');
      expect(result).toBeUndefined();

      const sb = createServiceClient();
      const { data: profile } = await sb
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single();
      expect(profile?.username).toBe('jane_x');
    });
  });

  describe('format validation', () => {
    it('rejects a too-short username without completing onboarding', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      const result = await completeOnboarding('TALENT', 'ab');
      expect(result).toEqual({ error: 'username_invalid' });

      const sb = createServiceClient();
      const { data: profile } = await sb
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      expect(profile).toBeNull();
    });
  });

  describe('photographer slug', () => {
    it('mirrors slug to the chosen username (or persists username where slug is absent)', async () => {
      const user = await createAuthUserWithoutProfile();
      mockSession.userId = user.id;

      await completeOnboarding('PHOTOGRAPHER', 'studio_lopez');

      const sb = createServiceClient();

      // The cloud schema has `slug`; the stripped-down local DB may not. Probe
      // the column so this asserts the right thing on either schema.
      const { error: slugProbe } = await sb.from('profiles').select('slug').limit(1);
      const hasSlugColumn = !slugProbe;

      const { data: profile } = await sb
        .from('profiles')
        .select(hasSlugColumn ? 'username, slug, active_role' : 'username, active_role')
        .eq('id', user.id)
        .single<{ username: string; active_role: string; slug?: string }>();
      expect(profile?.active_role).toBe('PHOTOGRAPHER');
      expect(profile?.username).toBe('studio_lopez');
      if (hasSlugColumn) {
        // slug mirrors the chosen username so /photographer/studio_lopez resolves.
        expect(profile?.slug).toBe('studio_lopez');
      }
    });
  });

  describe('checkUsernameAvailability', () => {
    it('reports an unused, valid username as available', async () => {
      const user = await createTestUser('TALENT', { username: 'owner_one' });
      mockSession.userId = user.id;

      const result = await checkUsernameAvailability('totally_free_name');
      expect(result).toEqual({ available: true });
    });

    it('reports a username owned by another user as unavailable', async () => {
      await createTestUser('TALENT', { username: 'someone_else' });
      const user = await createTestUser('TALENT', { username: 'me_myself' });
      mockSession.userId = user.id;

      const result = await checkUsernameAvailability('someone_else');
      expect(result).toEqual({ available: false, reason: 'taken' });
    });

    it("treats the caller's own username as available", async () => {
      const user = await createTestUser('TALENT', { username: 'my_handle' });
      mockSession.userId = user.id;

      const result = await checkUsernameAvailability('my_handle');
      expect(result).toEqual({ available: true });
    });

    it('reports an invalid username with reason "invalid"', async () => {
      const user = await createTestUser('TALENT', { username: 'valid_owner' });
      mockSession.userId = user.id;

      const result = await checkUsernameAvailability('ab');
      expect(result).toEqual({ available: false, reason: 'invalid' });
    });
  });
});
