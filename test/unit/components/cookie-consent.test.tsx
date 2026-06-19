/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieConsent } from '@/components/cookie-consent';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { COOKIE_CONSENT_STORAGE_KEY, openCookiePreferences } from '@/lib/cookie-consent';

// Stub the analytics SDK wrapper so we can assert *whether* it mounts, without
// pulling in the real Vercel beacons.
vi.mock('@/components/analytics', () => ({
  WebAnalytics: () => <div data-testid="web-analytics" />,
}));

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

function renderConsent() {
  return render(<CookieConsent dict={en.cookieConsent} privacyHref="/en/privacy-policy" />);
}

describe('CookieConsent gating', () => {
  it('shows the banner and does NOT load analytics before a decision', async () => {
    renderConsent();
    expect(await screen.findByText(en.cookieConsent.title)).toBeTruthy();
    expect(screen.queryByTestId('web-analytics')).toBeNull();
  });

  it('loads analytics and hides the banner after accepting', async () => {
    renderConsent();
    fireEvent.click(await screen.findByRole('button', { name: en.cookieConsent.accept }));
    expect(await screen.findByTestId('web-analytics')).toBeTruthy();
    expect(screen.queryByText(en.cookieConsent.title)).toBeNull();
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe('granted');
  });

  it('keeps analytics off and hides the banner after rejecting', async () => {
    renderConsent();
    fireEvent.click(await screen.findByRole('button', { name: en.cookieConsent.reject }));
    await waitFor(() =>
      expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe('denied'),
    );
    expect(screen.queryByTestId('web-analytics')).toBeNull();
    expect(screen.queryByText(en.cookieConsent.title)).toBeNull();
  });

  it('respects a stored "granted" decision on mount (no banner, analytics on)', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'granted');
    renderConsent();
    expect(await screen.findByTestId('web-analytics')).toBeTruthy();
    expect(screen.queryByText(en.cookieConsent.title)).toBeNull();
  });

  it('respects a stored "denied" decision on mount (no banner, no analytics)', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'denied');
    renderConsent();
    // Give the mount effect a tick to run, then assert nothing rendered.
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.title)).toBeNull());
    expect(screen.queryByTestId('web-analytics')).toBeNull();
  });

  it('re-opens the banner when cookie preferences are requested', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'denied');
    renderConsent();
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.title)).toBeNull());
    openCookiePreferences();
    expect(await screen.findByText(en.cookieConsent.title)).toBeTruthy();
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
