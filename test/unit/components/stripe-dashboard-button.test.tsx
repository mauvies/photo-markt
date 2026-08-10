/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-244: the way a photographer reaches their own Stripe Express dashboard.
 *
 * Two behaviours matter here and neither is cosmetic:
 *
 *   1. **The tab is claimed inside the click**, before awaiting the action.
 *      Opening it afterwards loses the user-gesture context and browsers block it
 *      as a popup — the button would silently do nothing, which is the worst
 *      possible failure for "take me to my money".
 *   2. **A refused link says why.** The account can be mid-onboarding, or Stripe
 *      can be down, and those need different copy.
 */

const createLinkMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ ok: true; url: string } | { ok: false; error: string }>>(),
);

vi.mock('@/app/[lang]/actions/stripe-dashboard', () => ({
  createStripeDashboardLinkAction: createLinkMock,
}));

import { StripeDashboardButton } from '@/components/stripe-dashboard-button';

const LABEL = 'Open my Stripe dashboard';
const NOT_READY = 'Finish setting up your Stripe account first.';
const UNAVAILABLE = "We couldn't reach Stripe just now.";

function renderButton() {
  return render(
    <StripeDashboardButton
      label={LABEL}
      errorNotReady={NOT_READY}
      errorUnavailable={UNAVAILABLE}
      title="Opens your Stripe account in a new tab"
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  createLinkMock.mockReset();
});

describe('StripeDashboardButton', () => {
  it('opens the tab during the click, not after the await', () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    // Never resolves: whatever happens before the await must already have run.
    createLinkMock.mockReturnValue(new Promise(() => {}));

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('never passes noopener, which would return null and strand the blank tab', () => {
    // Shipped once: `window.open` returns `null` by spec when `noopener` is in
    // the features string, so the handle-based flow became unreachable — the new
    // tab stayed blank and focused while the fallback navigated the tab the
    // photographer was already on. `opener` is cleared explicitly instead.
    const tab = { location: { href: '' }, close: vi.fn(), opener: {} as unknown };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    createLinkMock.mockReturnValue(new Promise(() => {}));

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    const features = openSpy.mock.calls[0]?.[2];
    expect(features ?? '').not.toContain('noopener');
    expect(tab.opener).toBeNull();
  });

  it('navigates the opened tab to the minted URL', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    createLinkMock.mockResolvedValue({ ok: true, url: 'https://connect.stripe.com/express/abc' });

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    await waitFor(() => {
      expect(tab.location.href).toBe('https://connect.stripe.com/express/abc');
    });
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('closes the blank tab and explains a not-ready account', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    createLinkMock.mockResolvedValue({ ok: false, error: 'not_ready' });

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    await waitFor(() => expect(screen.getByText(NOT_READY)).toBeDefined());
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it('distinguishes Stripe being unreachable from a not-ready account', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    createLinkMock.mockResolvedValue({ ok: false, error: 'stripe_unavailable' });

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    await waitFor(() => expect(screen.getByText(UNAVAILABLE)).toBeDefined());
    expect(screen.queryByText(NOT_READY)).toBeNull();
  });
});
