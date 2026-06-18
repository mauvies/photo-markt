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

  it('sends an authenticated talent to the talent dashboard (explore)', () => {
    expect(homeRedirectPath(true, 'TALENT')).toBe('/dashboard/talent');
  });

  it('defaults an authenticated user with no/unknown role to the talent dashboard', () => {
    expect(homeRedirectPath(true, null)).toBe('/dashboard/talent');
    expect(homeRedirectPath(true, undefined)).toBe('/dashboard/talent');
  });
});
