import { describe, expect, it } from 'vitest';
import {
  accountDropdownLinks,
  buildPhotographerSidebarItems,
  showSidebarSupportFeedback,
} from '@/lib/nav/photographer-nav';

const labels = {
  overview: 'Overview',
  events: 'Events',
  createEvent: 'Create event',
  sales: 'Sales',
  profile: 'Profile',
  settings: 'Settings',
};

describe('buildPhotographerSidebarItems (T-075)', () => {
  it('returns the six sidebar links in order, including Settings', () => {
    const items = buildPhotographerSidebarItems(labels);
    expect(items.map((i) => i.key)).toEqual([
      'overview',
      'events',
      'createEvent',
      'sales',
      'profile',
      'settings',
    ]);
  });

  it('adds Settings pointing at the settings page', () => {
    const settings = buildPhotographerSidebarItems(labels).find((i) => i.key === 'settings');
    expect(settings).toBeDefined();
    expect(settings?.title).toBe('Settings');
    expect(settings?.url).toBe('/dashboard/photographer/settings');
  });

  it('labels the earnings destination "Sales" (renamed from Earnings) but keeps the /sales route', () => {
    const sales = buildPhotographerSidebarItems(labels).find((i) => i.key === 'sales');
    expect(sales?.title).toBe('Sales');
    expect(sales?.url).toBe('/dashboard/photographer/sales');
  });

  it('points Profile at the dashboard-wrapped preview, not the settings profile tab', () => {
    const profile = buildPhotographerSidebarItems(labels).find((i) => i.key === 'profile');
    expect(profile?.url).toBe('/dashboard/photographer/profile/preview');
    // Distinct from the Settings profile tab under /settings.
    expect(profile?.url).not.toContain('/settings');
  });
});

describe('showSidebarSupportFeedback (T-075)', () => {
  it('hides the sidebar Support/Feedback section for photographers (moved to the avatar dropdown)', () => {
    expect(showSidebarSupportFeedback('photographer')).toBe(false);
  });

  it('keeps it for talent', () => {
    expect(showSidebarSupportFeedback('talent')).toBe(true);
  });
});

describe('accountDropdownLinks (T-075)', () => {
  it('drops Profile/Settings from the photographer desktop dropdown (the sidebar carries them)', () => {
    expect(accountDropdownLinks('photographer', 'desktop-header')).toEqual([]);
  });

  it('keeps Profile/Settings in the photographer mobile dropdown (the bottom nav omits them)', () => {
    expect(accountDropdownLinks('photographer', 'mobile-bottom')).toEqual(['profile', 'settings']);
  });

  it('keeps Profile/Settings for talent on both surfaces (no sidebar to carry them)', () => {
    expect(accountDropdownLinks('talent', 'desktop-header')).toEqual(['profile', 'settings']);
    expect(accountDropdownLinks('talent', 'mobile-bottom')).toEqual(['profile', 'settings']);
  });
});
