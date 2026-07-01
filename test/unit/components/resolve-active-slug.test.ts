import { describe, expect, it } from 'vitest';
import { resolveActiveSlug } from '@/components/settings/resolve-active-slug';
import type { SettingsSection } from '@/components/settings/settings-shell';

const BASE = '/es/dashboard/photographer/settings';

const photographerSections: SettingsSection[] = [
  { slug: 'profile', label: 'Perfil', href: `${BASE}/profile` },
  { slug: 'billing', label: 'Facturación', href: `${BASE}/billing` },
  { slug: 'payouts', label: 'Pagos', href: `${BASE}/payouts` },
  { slug: 'language', label: 'Idioma', href: `${BASE}/language` },
];

// Talent reuses SettingsShell but has no payouts/payout-profile.
const talentSections: SettingsSection[] = [
  { slug: 'profile', label: 'Perfil', href: '/es/dashboard/talent/settings/profile' },
  { slug: 'account', label: 'Cuenta', href: '/es/dashboard/talent/settings/account' },
  { slug: 'language', label: 'Idioma', href: '/es/dashboard/talent/settings/language' },
];

describe('resolveActiveSlug', () => {
  it('highlights the exact matching tab', () => {
    expect(resolveActiveSlug(`${BASE}/billing`, photographerSections)).toBe('billing');
    expect(resolveActiveSlug(`${BASE}/payouts`, photographerSections)).toBe('payouts');
    expect(resolveActiveSlug(`${BASE}/profile`, photographerSections)).toBe('profile');
  });

  // The bug: payout-profile is a sibling of payouts (not nested under it), so
  // exact match failed and it fell back to the first tab (profile).
  it('maps the payout-profile sibling route to the Payouts tab', () => {
    expect(resolveActiveSlug(`${BASE}/payout-profile`, photographerSections)).toBe('payouts');
  });

  it('keeps a payout-profile subroute on the Payouts tab', () => {
    expect(resolveActiveSlug(`${BASE}/payout-profile/edit`, photographerSections)).toBe('payouts');
  });

  it('keeps nested subroutes of a section on that section tab', () => {
    expect(resolveActiveSlug(`${BASE}/payouts/history`, photographerSections)).toBe('payouts');
  });

  it('does not treat payouts as a prefix of payout-profile', () => {
    // Guard against a naive startsWith('/payouts'): payout-profile must not
    // match the payouts *href* prefix — it resolves via the sibling map only.
    expect(resolveActiveSlug(`${BASE}/payout-profile`, photographerSections)).not.toBe('profile');
  });

  it('falls back to the first section for unknown routes', () => {
    expect(resolveActiveSlug(`${BASE}`, photographerSections)).toBe('profile');
    expect(resolveActiveSlug(`${BASE}/does-not-exist`, photographerSections)).toBe('profile');
  });

  it('does not break the talent shell (no payouts section present)', () => {
    expect(resolveActiveSlug('/es/dashboard/talent/settings/account', talentSections)).toBe(
      'account',
    );
    // A payout-profile-shaped path with no payouts section must not invent one.
    expect(resolveActiveSlug('/es/dashboard/talent/settings/payout-profile', talentSections)).toBe(
      'profile',
    );
  });
});
