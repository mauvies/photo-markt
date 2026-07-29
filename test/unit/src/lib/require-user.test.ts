/**
 * Regression test for T-198 — the intermittent Next error screen on
 * `/[lang]/dashboard/talent`.
 *
 * Root cause: Next renders the segments of a route in parallel, so the login
 * guard in `dashboard/layout.tsx` does NOT stop `dashboard/talent/layout.tsx`
 * from running. Signed out, that child layout reached `getRoleContext()`, which
 * throws `You must be signed in to manage roles.` — a plain Error that raced
 * the parent's NEXT_REDIRECT into the `[lang]/error.tsx` boundary. A single
 * signed-out request produced all three outcomes at once:
 *   NEXT_REDIRECT ... /en/dashboard/talent/events   (the page)
 *   NEXT_REDIRECT ... /en/login?next=/dashboard/talent (the parent guard)
 *   Error: You must be signed in to manage roles.   (the talent layout)
 *
 * `requireUser()` is the shared fix: a missing user becomes a redirect, never a
 * throw, so every racing outcome is a redirect and the visitor always lands on
 * a page.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUser: { value: { id: string } | null } = { value: null };

vi.mock('@/database/server', () => ({
  getUser: vi.fn(async () => mockUser.value),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () =>
      new Headers({
        'x-lang': 'en',
        'x-pathname': '/en/dashboard/talent',
        'x-search': '',
      }),
  ),
}));

import { requireUser } from '@/lib/auth/require-user';

/** The digest Next stamps on the error thrown by `redirect()`. */
function redirectDigest(error: unknown): string | null {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT') ? digest : null;
}

describe('requireUser', () => {
  beforeEach(() => {
    mockUser.value = null;
  });

  it('redirects to login (never throws a plain Error) when there is no user', async () => {
    // The whole point: a segment rendering without a session must produce a
    // NEXT_REDIRECT, not an Error that the error boundary can render.
    const error = await requireUser().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).not.toBeNull();
    expect(redirectDigest(error)).toContain('NEXT_REDIRECT');
  });

  it('captures the current path as ?next= so login returns the user here', async () => {
    const error = await requireUser().then(
      () => null,
      (e: unknown) => e,
    );

    expect(redirectDigest(error)).toContain('/en/login?next=%2Fdashboard%2Ftalent');
  });

  it('returns the user untouched when signed in', async () => {
    mockUser.value = { id: 'user-1' };

    await expect(requireUser()).resolves.toEqual({ id: 'user-1' });
  });
});
