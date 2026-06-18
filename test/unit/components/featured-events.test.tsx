/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturedEvents } from '@/app/[lang]/featured-events';
import type { TopEventItem } from '@/app/[lang]/top-events-actions';

// Isolate the empty-state logic: stub the heavy children (next/image + providers).
vi.mock('@/components/event-card', () => ({
  EventCard: ({ name }: { name: string }) => <div>{name}</div>,
}));
vi.mock('@/components/event-save-button', () => ({
  EventSaveButton: () => null,
}));

afterEach(cleanup);

const t = {
  title: 'Featured Events',
  exploreAllEvents: 'Explore all events',
  statusAll: 'All',
  statusUpcoming: 'Upcoming',
  statusCompleted: 'Completed',
  noEvents: 'No events available yet.',
  card: {
    photo: 'photo',
    photos: 'photos',
    noPhotosYet: 'No photos yet',
    comingSoon: 'Coming soon',
    imageUnavailable: 'Image unavailable',
  },
};

const upcomingEvent: TopEventItem = {
  id: 'e1',
  slug: 'race-1',
  name: 'Race One',
  date: '2026-07-01',
  city: 'Madrid',
  country: 'ES',
  activity: 'running',
  pricePerPhoto: 500,
  photoCount: 10,
  coverUrl: null,
  coverThumbUrl: null,
  photographerUsername: 'pho',
  photographerDisplayName: 'Pho Tographer',
  status: 'upcoming',
};

function renderFeatured(events: TopEventItem[]) {
  return render(<FeaturedEvents events={events} lang="en" activities={{} as never} t={t} />);
}

describe('FeaturedEvents empty state', () => {
  it('shows the empty message (not a collapsed section) when the selected tab has no events', () => {
    renderFeatured([upcomingEvent]);

    // "All" tab shows the upcoming event, no empty message.
    expect(screen.getByText('Race One')).toBeTruthy();
    expect(screen.queryByText(t.noEvents)).toBeNull();

    // Switch to "Completed" — there are no completed events.
    fireEvent.click(screen.getByRole('button', { name: t.statusCompleted }));

    expect(screen.queryByText('Race One')).toBeNull();
    expect(screen.getByText(t.noEvents)).toBeTruthy();
  });

  it('renders nothing when there are no events at all', () => {
    const { container } = renderFeatured([]);
    expect(container.firstChild).toBeNull();
  });
});
