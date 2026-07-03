import { describe, expect, it } from 'vitest';
import { dashboardHomeForRole, resolveDashboardHome } from '@/lib/auth/dashboard-home';

describe('dashboardHomeForRole', () => {
  it('maps photographer to the photographer overview', () => {
    expect(dashboardHomeForRole('photographer')).toBe('/dashboard/photographer');
  });

  it('maps talent to the talent dashboard', () => {
    expect(dashboardHomeForRole('talent')).toBe('/dashboard/talent');
  });
});

describe('resolveDashboardHome', () => {
  it('honors the active role when the user holds it', () => {
    expect(resolveDashboardHome('photographer', ['photographer'])).toBe('/dashboard/photographer');
    expect(resolveDashboardHome('talent', ['talent'])).toBe('/dashboard/talent');
    expect(resolveDashboardHome('talent', ['photographer', 'talent'])).toBe('/dashboard/talent');
  });

  // Regression (T-061): a stale active_role pointing at an unheld role must not
  // loop — fall back to a role the user actually holds.
  it('falls back to a held role when active_role is desynced', () => {
    expect(resolveDashboardHome('talent', ['photographer'])).toBe('/dashboard/photographer');
    expect(resolveDashboardHome('photographer', ['talent'])).toBe('/dashboard/talent');
  });

  it('prefers photographer when both roles are held but active_role is unheld/null', () => {
    expect(resolveDashboardHome(null, ['photographer', 'talent'])).toBe('/dashboard/photographer');
  });

  it('sends a user with no held roles to onboarding', () => {
    expect(resolveDashboardHome(null, [])).toBe('/onboarding/role');
    expect(resolveDashboardHome('talent', [])).toBe('/onboarding/role');
  });
});
