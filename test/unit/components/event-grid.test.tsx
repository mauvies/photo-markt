/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

vi.mock('next/navigation', () => ({
  useParams: () => ({ lang: 'es' }),
}));

// EventCard (rendered on the loaded, non-skeleton path) pulls in these —
// mocked the same way event-card.test.tsx does, so importing EventGrid here
// doesn't drag in server-only actions (supabaseAdmin) through them. The
// skeleton path under test never touches EventCard, but the import graph
// still needs to resolve.
vi.mock('@/components/event-save-button', () => ({
  EventSaveButton: () => <div data-testid="save-btn" />,
}));
vi.mock('@/components/event-share-button', () => ({
  EventShareButton: () => <div data-testid="share-btn" />,
}));

const { EventGrid } = await import('@/app/[lang]/dashboard/talent/events/components/event-grid');

const translations = {
  searchPrompt: '',
  noEventsFound: '',
  noEventsFoundDesc: '',
  clearFilters: '',
  loadMore: '',
  photo: 'photo',
  photos: 'photos',
  noPhotosYet: '',
  comingSoon: '',
  imageUnavailable: '',
  share: '',
  activities: {},
};

afterEach(cleanup);

describe('EventGrid loading state (T-128)', () => {
  it('renders the real-card-shaped skeleton, not the old aspect-square block', () => {
    const { container } = render(
      <TranslationsProvider translations={translations}>
        <EventGrid
          events={[]}
          isLoading
          isInitialLoad={false}
          hasSearched
          hasMore={false}
          skeletonKeys={['a', 'b']}
          onLoadMore={() => {}}
        />
      </TranslationsProvider>,
    );
    // The pre-T-128 skeleton used `aspect-square` tiles; the redesigned
    // EventCard (T-119/T-125) uses `aspect-[4/3]`.
    expect(container.innerHTML).toContain('aspect-[4/3]');
    expect(container.innerHTML).not.toContain('aspect-square');
    // Two skeleton cards for the two skeleton keys.
    expect(container.querySelectorAll('.rounded-2xl').length).toBe(2);
  });
});
