import { describe, expect, it } from 'vitest';
import { homeRedirectPath } from '@/lib/auth/home-redirect';

describe('homeRedirectPath', () => {
  it('does not redirect anonymous visitors', () => {
    expect(homeRedirectPath(false, null)).toBeNull();
    expect(homeRedirectPath(false, 'PHOTOGRAPHER')).toBeNull();
  });

  it('sends an authenticated photographer to the photographer dashboard', () => {
    expect(homeRedirectPath(true, 'PHOTOGRAPHER')).toBe('/dashboard/photographer');
  });

  // T-118: the public home is now the unified talent home — an authenticated
  // talent stays on `/` instead of being bounced to a dashboard route.
  it('keeps an authenticated talent on the public home', () => {
    expect(homeRedirectPath(true, 'TALENT')).toBeNull();
  });

  it('defaults an authenticated user with no/unknown role to the talent dashboard', () => {
    expect(homeRedirectPath(true, null)).toBe('/dashboard/talent');
    expect(homeRedirectPath(true, undefined)).toBe('/dashboard/talent');
  });
});
