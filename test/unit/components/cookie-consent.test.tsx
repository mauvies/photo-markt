/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieConsent } from '@/components/cookie-consent';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { COOKIE_CONSENT_STORAGE_KEY, openCookiePreferences } from '@/lib/cookie-consent';

// Stub the analytics SDK wrapper so we can assert *whether* it mounts, without
// pulling in the real Vercel beacons.
vi.mock('@/components/analytics', () => ({
  WebAnalytics: () => <div data-testid="web-analytics" />,
}));

// Radix Dialog/Switch expect a few DOM APIs happy-dom omits.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  for (const fn of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(fn in Element.prototype)) {
      // biome-ignore lint/suspicious/noExplicitAny: minimal test polyfill
      (Element.prototype as any)[fn] = () => false;
    }
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

function renderConsent() {
  return render(<CookieConsent dict={en.cookieConsent} privacyHref="/en/privacy-policy" />);
}

const stored = () => window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);

describe('CookieConsent gating', () => {
  it('shows the banner and does NOT load analytics before a decision', async () => {
    renderConsent();
    expect(await screen.findByText(en.cookieConsent.title)).toBeTruthy();
    expect(screen.queryByTestId('web-analytics')).toBeNull();
  });

  it('loads analytics and persists per-category consent after Accept all', async () => {
    renderConsent();
    fireEvent.click(await screen.findByRole('button', { name: en.cookieConsent.accept }));
    expect(await screen.findByTestId('web-analytics')).toBeTruthy();
    expect(screen.queryByText(en.cookieConsent.title)).toBeNull();
    expect(JSON.parse(stored() ?? '{}')).toEqual({ analytics: true });
  });

  it('keeps analytics off and persists denial after Reject all', async () => {
    renderConsent();
    fireEvent.click(await screen.findByRole('button', { name: en.cookieConsent.reject }));
    await waitFor(() => expect(JSON.parse(stored() ?? '{}')).toEqual({ analytics: false }));
    expect(screen.queryByTestId('web-analytics')).toBeNull();
    expect(screen.queryByText(en.cookieConsent.title)).toBeNull();
  });

  it('respects a stored per-category granted decision on mount', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ analytics: true }));
    renderConsent();
    expect(await screen.findByTestId('web-analytics')).toBeTruthy();
    expect(screen.queryByText(en.cookieConsent.title)).toBeNull();
  });
});

describe('CookieConsent legacy migration (T-024 binary values)', () => {
  it('migrates a legacy "granted" string to analytics-on (no banner, analytics loads)', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'granted');
    renderConsent();
    expect(await screen.findByTestId('web-analytics')).toBeTruthy();
    expect(screen.queryByText(en.cookieConsent.title)).toBeNull();
  });

  it('migrates a legacy "denied" string to analytics-off (no banner, no analytics)', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'denied');
    renderConsent();
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.title)).toBeNull());
    expect(screen.queryByTestId('web-analytics')).toBeNull();
  });
});

describe('CookieConsent granular panel', () => {
  it('opens the panel from the footer event and shows category toggles', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ analytics: false }));
    renderConsent();
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.title)).toBeNull());

    openCookiePreferences();

    expect(await screen.findByText(en.cookieConsent.manageTitle)).toBeTruthy();
    const necessary = screen.getByRole('switch', { name: en.cookieConsent.necessaryTitle });
    expect((necessary as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('switch', { name: en.cookieConsent.analyticsTitle })).toBeTruthy();
  });

  it('enabling analytics in the panel and saving loads analytics', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ analytics: false }));
    renderConsent();
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.title)).toBeNull());

    openCookiePreferences();
    fireEvent.click(await screen.findByRole('switch', { name: en.cookieConsent.analyticsTitle }));
    fireEvent.click(screen.getByRole('button', { name: en.cookieConsent.save }));

    expect(await screen.findByTestId('web-analytics')).toBeTruthy();
    expect(JSON.parse(stored() ?? '{}')).toEqual({ analytics: true });
  });

  it('Customize from the banner opens the panel without deciding yet', async () => {
    renderConsent();
    fireEvent.click(await screen.findByRole('button', { name: en.cookieConsent.customize }));
    expect(await screen.findByText(en.cookieConsent.manageTitle)).toBeTruthy();
    // No decision persisted just by opening the panel.
    expect(stored()).toBeNull();
    expect(screen.queryByTestId('web-analytics')).toBeNull();
  });
});

describe('cookieConsent dictionary parity', () => {
  it('has the same non-empty keys in both locales, translated', () => {
    const keys = Object.keys(en.cookieConsent).sort();
    expect(Object.keys(es.cookieConsent).sort()).toEqual(keys);
    for (const value of Object.values(es.cookieConsent)) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
    // The user-facing copy should actually be translated, not copied from English.
    expect(es.cookieConsent.title).not.toBe(en.cookieConsent.title);
    expect(es.cookieConsent.accept).not.toBe(en.cookieConsent.accept);
  });
});
