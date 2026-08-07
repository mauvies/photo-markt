/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventCardSkeleton, EventGridSkeleton } from '@/components/event-card-skeleton';
import { EVENT_CARD_COVER_ASPECT } from '@/lib/event-card-aspect';

afterEach(cleanup);

describe('EventCardSkeleton (T-128)', () => {
  it('mirrors the real EventCard cover ratio and two-line title reservation', () => {
    const { container } = render(<EventCardSkeleton />);
    // Matches event-card.tsx's rounded-2xl card + shared cover ratio (T-233) —
    // the old skeleton used a mismatched aspect-square cover.
    expect(container.innerHTML).toContain('rounded-2xl');
    expect(container.innerHTML).toContain(EVENT_CARD_COVER_ASPECT);
    // Matches the two-line title height reserved by the real card (T-127) —
    // without this a one-line skeleton title collapses and the rows below it
    // sit at a different height than the loaded card.
    expect(container.innerHTML).toContain('min-h-[3.1rem]');
    // Matches the divided photographer row at the bottom of the real card.
    expect(container.querySelector('.border-t')).not.toBeNull();
  });

  it('reuses the Skeleton primitive rather than ad-hoc pulse divs', () => {
    const { container } = render(<EventCardSkeleton />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe('EventGridSkeleton', () => {
  it('renders one EventCardSkeleton per count, in the real card-grid layout', () => {
    const { container } = render(<EventGridSkeleton count={3} />);
    // Matches EventGrid's real grid columns.
    expect(container.innerHTML).toContain(
      'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4',
    );
    expect(container.querySelectorAll('.rounded-2xl').length).toBe(3);
  });
});
