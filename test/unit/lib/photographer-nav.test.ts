import { describe, expect, it } from 'vitest';
import {
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
