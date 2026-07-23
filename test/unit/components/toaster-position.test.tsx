/** @vitest-environment happy-dom */
/**
 * T-175 — mobile toast placement depends on auth state. A previous ticket put
 * ALL mobile toasts at the top because a bottom toast covered the fixed bottom
 * nav — but that nav only exists for authenticated viewers. Unauthenticated
 * viewers have no bottom nav, so bottom is the better placement for them.
 *
 * Regression: on mobile, a logged-out viewer (`user === null`) must get
 * `bottom-center`; a logged-in viewer gets `top-center`; the pre-resolution
 * window (`user === undefined`) fails safe to `top-center` so we never risk
 * covering a nav that may be there. Desktop is always `bottom-right`. Fails
 * before the fix (mobile was unconditionally `top-center`), passes after.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Capture the props our wrapper passes to sonner's Toaster.
const captured: { position?: string } = {};
vi.mock('sonner', () => ({
  Toaster: (props: { position?: string }) => {
    captured.position = props.position;
    return null;
  },
}));

const state: { mobile: boolean; user: unknown } = { mobile: false, user: undefined };
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => state.mobile,
}));
vi.mock('@/hooks/use-auth-user', () => ({
  useAuthUser: () => ({ user: state.user }),
}));

import { Toaster } from '@/components/ui/sonner';

afterEach(() => {
  cleanup();
  captured.position = undefined;
});

function positionFor({ mobile, user }: { mobile: boolean; user: unknown }): string | undefined {
  state.mobile = mobile;
  state.user = user;
  render(<Toaster />);
  return captured.position;
}

describe('Toaster — mobile placement by auth state (T-175)', () => {
  it('places toasts at the bottom for unauthenticated mobile viewers', () => {
    expect(positionFor({ mobile: true, user: null })).toBe('bottom-center');
  });

  it('keeps toasts at the top for authenticated mobile viewers (bottom nav must not be covered)', () => {
    expect(positionFor({ mobile: true, user: { id: 'u1' } })).toBe('top-center');
  });

  it('fails safe to the top while auth is still resolving on mobile', () => {
    expect(positionFor({ mobile: true, user: undefined })).toBe('top-center');
  });

  it('keeps desktop at bottom-right regardless of auth state', () => {
    expect(positionFor({ mobile: false, user: null })).toBe('bottom-right');
    expect(positionFor({ mobile: false, user: { id: 'u1' } })).toBe('bottom-right');
  });
});
