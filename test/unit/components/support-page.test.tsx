/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SupportPage } from '@/components/support-page';
import en from '@/dictionaries/en.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

vi.mock('@/app/[lang]/actions/feedback', () => ({
  submitFeedbackAction: vi.fn(async () => {}),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix primitives (Select/Collapsible) expect a few DOM APIs happy-dom omits.
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

afterEach(cleanup);

function renderSupport(role: 'talent' | 'photographer') {
  return render(
    <TranslationsProvider translations={en.support}>
      <SupportPage userRole={role} />
    </TranslationsProvider>,
  );
}

describe('SupportPage', () => {
  it('renders talent-specific FAQs and quick actions from the dictionary', () => {
    renderSupport('talent');
    expect(screen.getByText(en.support.faqsTalent[0].question)).toBeTruthy();
    expect(screen.getByText(en.support.quickActionsTalent[0].title)).toBeTruthy();
    // Photographer-only content must not leak into the talent view.
    expect(screen.queryByText(en.support.faqsPhotographer[0].question)).toBeNull();
  });

  it('renders photographer-specific FAQs from the dictionary', () => {
    renderSupport('photographer');
    expect(screen.getByText(en.support.faqsPhotographer[0].question)).toBeTruthy();
    expect(screen.queryByText(en.support.faqsTalent[0].question)).toBeNull();
  });

  it('uses the translated title and submit label (no hardcoded copy)', () => {
    renderSupport('talent');
    expect(screen.getByRole('heading', { name: en.support.title })).toBeTruthy();
    expect(screen.getByText(en.support.send)).toBeTruthy();
  });
});
