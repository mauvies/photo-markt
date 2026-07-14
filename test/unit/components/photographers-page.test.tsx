/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';

vi.mock('@/database/server', () => ({
  getUser: vi.fn(async () => null),
}));

vi.mock('@/lib/i18n/get-dictionary', () => ({
  getDictionary: vi.fn(async () => en),
}));

// PricingSection's internals (plans/checkout) aren't under test — stub it to
// a marker so we can assert the existing component is reused on this page.
vi.mock('@/components/pricing-section', () => ({
  PricingSection: () => <section data-testid="pricing-section" />,
}));

import PhotographersPage from '@/app/[lang]/photographers/page';

afterEach(cleanup);

async function renderPage() {
  const ui = await PhotographersPage({ params: Promise.resolve({ lang: 'en' }) });
  return render(ui);
}

// T-120: the photographers landing carries trust signals, the reused
// PricingSection, an FAQ accordion, and click-through CTAs to /signup.
describe('/photographers landing (T-120)', () => {
  it('renders hero and final CTAs as click-throughs to the localized signup', async () => {
    await renderPage();
    const heroCta = screen.getByText(en.photographersPage.heroCta).closest('a');
    expect(heroCta?.getAttribute('href')).toBe('/en/signup');
    const finalCta = screen.getByText(en.home.ctaCreateAccount).closest('a');
    expect(finalCta?.getAttribute('href')).toBe('/en/signup');
  });

  it('renders the four genuine trust signals', async () => {
    await renderPage();
    expect(screen.getByText(en.photographersPage.trustStripeTitle)).toBeTruthy();
    expect(screen.getByText(en.photographersPage.trustFreeTitle)).toBeTruthy();
    expect(screen.getByText(en.photographersPage.trustEconomicsTitle)).toBeTruthy();
    expect(screen.getByText(en.photographersPage.trustPrivacyTitle)).toBeTruthy();
  });

  it('reuses the existing PricingSection component', async () => {
    await renderPage();
    expect(screen.getByTestId('pricing-section')).toBeTruthy();
  });

  it('renders every FAQ question and expands the answer on click', async () => {
    await renderPage();
    expect(screen.getByText(en.photographersPage.faqTitle)).toBeTruthy();
    for (const item of en.photographersPage.faqItems) {
      expect(screen.getByText(item.question)).toBeTruthy();
    }
    const first = en.photographersPage.faqItems[0];
    // Collapsed by default — the answer only mounts once its item is opened.
    expect(screen.queryByText(first.answer)).toBeNull();
    fireEvent.click(screen.getByText(first.question));
    expect(screen.getByText(first.answer)).toBeTruthy();
  });
});
