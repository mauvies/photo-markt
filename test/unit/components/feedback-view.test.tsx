/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackView } from '@/components/feedback-view';
import en from '@/dictionaries/en.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

vi.mock('@/app/[lang]/actions/feedback', () => ({
  submitFeedbackAction: vi.fn(async () => {}),
  toggleVoteAction: vi.fn(async () => ({ voted: true })),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/dashboard/talent/feedback',
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(cleanup);

function renderFeedback(role: 'talent' | 'photographer') {
  return render(
    <TranslationsProvider translations={en.feedback}>
      <FeedbackView userRole={role} initialVotes={[]} />
    </TranslationsProvider>,
  );
}

describe('FeedbackView', () => {
  it('renders category labels and the submit button from the dictionary', () => {
    renderFeedback('talent');
    expect(screen.getByText(en.feedback.categories.bug.label)).toBeTruthy();
    expect(screen.getByText(en.feedback.categories.feature.label)).toBeTruthy();
    expect(screen.getByText(en.feedback.send)).toBeTruthy();
  });

  it('renders the roadmap with AI matching marked Live (corrected content)', () => {
    renderFeedback('talent');
    expect(screen.getByText(en.feedback.roadmap[0].title)).toBeTruthy();
    // AI matching is shipped — its roadmap status must read "Live", not "In progress".
    expect(screen.getByText(en.feedback.statusLive)).toBeTruthy();
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('uses the role-specific description placeholder', () => {
    renderFeedback('photographer');
    expect(
      screen.getByPlaceholderText(en.feedback.descriptionPlaceholders.photographer),
    ).toBeTruthy();
  });
});
