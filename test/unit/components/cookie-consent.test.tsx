/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieConsent } from '@/components/cookie-consent';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
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

describe('CookieConsent dismiss persistence (T-170)', () => {
  it('dismissing the panel while undecided persists a reject so the banner does not reappear', async () => {
    const { unmount } = renderConsent();
    // Undecided → banner is up. Open the granular panel, then close it via the
    // Dialog X (no explicit choice).
    fireEvent.click(await screen.findByRole('button', { name: en.cookieConsent.customize }));
    await screen.findByText(en.cookieConsent.manageTitle);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    // Before the fix the dismiss wrote nothing → readCookieConsent stayed null →
    // the banner remounted on the next page. Now it persists analytics-off.
    await waitFor(() => expect(JSON.parse(stored() ?? '{}')).toEqual({ analytics: false }));
    expect(screen.queryByTestId('web-analytics')).toBeNull();

    // Simulate navigating to another page (e.g. the cart): a fresh mount must
    // NOT show the banner, because a decision is now stored.
    unmount();
    cleanup();
    renderConsent();
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.title)).toBeNull());
    expect(screen.queryByTestId('web-analytics')).toBeNull();
  });

  it('dismissing the panel does NOT overwrite an existing decision (footer re-open)', async () => {
    // Already decided: analytics granted. Open the panel from the footer and
    // close it without saving — the prior choice must survive untouched.
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ analytics: true }));
    renderConsent();
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.title)).toBeNull());

    openCookiePreferences();
    await screen.findByText(en.cookieConsent.manageTitle);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    // Still granted — the dismiss must not downgrade an existing decision to reject.
    await waitFor(() => expect(screen.queryByText(en.cookieConsent.manageTitle)).toBeNull());
    expect(JSON.parse(stored() ?? '{}')).toEqual({ analytics: true });
    expect(screen.queryByTestId('web-analytics')).toBeTruthy();
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

// T-169: banner layout — buttons stack full-width on mobile (no cramped wrap)
// and align in a row on desktop; the mobile position drops near the bottom edge,
// lifting above the mobile bottom-nav ONLY on routes that render it (dashboard).
describe('CookieConsentBanner layout (T-169)', () => {
  const noop = () => {};
  function renderBanner(hasBottomNav: boolean) {
    return render(
      <CookieConsentBanner
        dict={en.cookieConsent}
        privacyHref="/en/privacy-policy"
        hasBottomNav={hasBottomNav}
        onAcceptAll={noop}
        onRejectAll={noop}
        onCustomize={noop}
      />,
    );
  }

  it('sits near the bottom on routes without a bottom-nav (public)', () => {
    renderBanner(false);
    const dialog = screen.getByRole('dialog', { name: en.cookieConsent.title });
    expect(dialog.className).toContain('bottom-[calc(1rem+env(safe-area-inset-bottom))]');
    // No longer floats 4.5rem up on non-dashboard routes.
    expect(dialog.className).not.toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom))]');
  });

  it('lifts above the bottom-nav on dashboard routes', () => {
    renderBanner(true);
    const dialog = screen.getByRole('dialog', { name: en.cookieConsent.title });
    expect(dialog.className).toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom))]');
  });

  it('stacks buttons full-width on mobile and rows them on desktop (no wrap)', () => {
    renderBanner(false);
    const accept = screen.getByText(en.cookieConsent.accept);
    // Each button is full-width on mobile, auto on desktop.
    expect(accept.className).toContain('w-full');
    expect(accept.className).toContain('sm:w-auto');
    // The button row is a column on mobile → row on desktop, not a cramped wrap.
    const buttonRow = accept.parentElement as HTMLElement;
    expect(buttonRow.className).toContain('flex-col');
    expect(buttonRow.className).toContain('sm:flex-row');
    expect(buttonRow.className).not.toContain('flex-wrap');
  });
});
