/**
 * Regression test for T-198 — the intermittent Next error screen on
 * `/[lang]/dashboard/talent`.
 *
 * Next renders the segments of a route (parent layout → child layout → page)
 * **in parallel**, so the login guard in `dashboard/layout.tsx` does not stop
 * the role layouts or the `/dashboard` disambiguator from executing. Rendered
 * without a session they used to reach `getRoleContext()` /
 * `getProfileFields(supabase, '')`, both of which THROW a plain Error — and
 * that error raced the parent's redirect into the `[lang]/error.tsx` boundary.
 *
 * These tests drive the real route modules with no user and assert every one of
 * them produces a NEXT_REDIRECT instead of an Error. Before the fix the talent
 * layout rejected with `You must be signed in to manage roles.`
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUser: { value: { id: string; email: string } | null } = { value: null };

vi.mock('@/database/server', () => ({
  getUser: vi.fn(async () => mockUser.value),
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/database/queries', () => ({
  // Must never be reached without a user — the empty-uuid lookup it used to get
  // (`user?.id ?? ''`) is itself a throw (Postgres 22P02 invalid uuid).
  getProfileFields: vi.fn(async (_client: unknown, userId: string) => {
    if (!userId) throw new Error('Failed to get profile fields: invalid input syntax for uuid ""');
    return { display_name: 'Tester', avatar_url: null };
  }),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () =>
      new Headers({ 'x-lang': 'en', 'x-pathname': '/en/dashboard/talent', 'x-search': '' }),
  ),
}));

vi.mock('@/lib/i18n/get-lang-from-headers', () => ({
  getLangFromHeaders: vi.fn(async () => 'en'),
}));

// A signed-out render never gets far enough to use copy; a self-returning proxy
// keeps the test from caring which keys the layouts read.
const dictStub: unknown = new Proxy({}, { get: () => dictStub });
vi.mock('@/lib/i18n/get-dictionary', () => ({
  getDictionary: vi.fn(async () => dictStub),
}));

// The dashboard chrome is irrelevant here — stub it so the test exercises the
// guard, not the component tree.
vi.mock('@/components/talent-dashboard-header', () => ({ TalentDashboardHeader: () => null }));
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }));
vi.mock('@/components/dashboard-top-header', () => ({ DashboardTopHeader: () => null }));
vi.mock('@/components/photographer-bottom-nav', () => ({ PhotographerBottomNav: () => null }));
vi.mock('@/components/ui/sidebar', () => ({
  SidebarInset: () => null,
  SidebarProvider: () => null,
}));

import DashboardPage from '@/app/[lang]/dashboard/page';
import PhotographerLayout from '@/app/[lang]/dashboard/photographer/layout';
import TalentLayout from '@/app/[lang]/dashboard/talent/layout';

/** The rejection reason, or `null` when the call unexpectedly resolved. */
async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => null,
    (error: unknown) => error,
  );
}

function digestOf(error: unknown): string {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === 'string' ? digest : '';
}

describe('dashboard segments without a session', () => {
  beforeEach(() => {
    mockUser.value = null;
  });

  const segments: Array<[string, () => Promise<unknown>]> = [
    ['talent layout', () => TalentLayout({ children: null })],
    ['photographer layout', () => PhotographerLayout({ children: null })],
    ['/dashboard disambiguator', () => DashboardPage({ params: Promise.resolve({ lang: 'en' }) })],
  ];

  for (const [name, run] of segments) {
    it(`${name} redirects to login instead of throwing`, async () => {
      const error = await rejectionOf(run);

      // A plain Error here is the bug: it renders the error boundary, because
      // the parent layout's redirect cannot stop this segment from running.
      expect(digestOf(error)).toContain('NEXT_REDIRECT');
      expect(digestOf(error)).toContain('/en/login');
      expect((error as Error)?.message).not.toContain('You must be signed in');
    });
  }
});
