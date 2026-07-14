/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ lang: 'es' }),
}));

// next/image doesn't fire onLoad in happy-dom, so the cover stays in its
// "loading" state (badges gated on load never mount). The stub renders a real
// <img> forwarding className/alt so the T-123 paint-gating tests can assert on
// it; Next-specific props are dropped.
vi.mock('next/image', () => ({
  default: ({ className, alt, src }: { className?: string; alt?: string; src?: string }) => (
    // biome-ignore lint/performance/noImgElement: test stub for next/image
    <img data-testid="next-image" className={className} alt={alt} src={src} />
  ),
}));

vi.mock('@/hooks/use-coarse-pointer', () => ({ useCoarsePointer: () => false }));

// The save/share controls are covered by their own tests; here we only assert
// the card renders them in the title row (explore mode).
vi.mock('@/components/event-save-button', () => ({
  EventSaveButton: () => <div data-testid="save-btn" />,
}));
vi.mock('@/components/event-share-button', () => ({
  EventShareButton: () => <div data-testid="share-btn" />,
}));

import { EventCard } from '@/components/event-card';

const baseProps = {
  id: 'e1',
  hrefParam: 'my-race',
  linkPrefix: '/events',
  name: 'City Marathon',
  date: '2026-06-06',
  city: 'Madrid',
  country: 'Spain',
  activity: 'running',
  activityLabel: 'Running',
  photoCount: 12,
  coverUrl: 'https://cdn.example/cover.jpg',
  photographer: { username: 'jane', displayName: 'Jane Doe' },
  t: {
    photo: 'foto',
    photos: 'fotos',
    noPhotosYet: 'Sin fotos',
    imageUnavailable: 'Imagen no disponible',
    share: 'Compartir',
  },
};

afterEach(cleanup);

describe('EventCard (T-119 redesign)', () => {
  it('renders share + save in the title row and no location pin (explore mode)', () => {
    const { getByTestId, container } = render(<EventCard {...baseProps} />);
    expect(getByTestId('save-btn')).toBeTruthy();
    expect(getByTestId('share-btn')).toBeTruthy();
    // The old MapPin-in-location-line is gone.
    expect(container.querySelector('.lucide-map-pin')).toBeNull();
  });

  it('shows the country flag after the location', () => {
    const { getByText } = render(<EventCard {...baseProps} />);
    expect(getByText('🇪🇸')).toBeTruthy();
  });

  it('links the photographer name to their public profile', () => {
    const { container } = render(<EventCard {...baseProps} />);
    const profileLink = container.querySelector('a[href="/es/photographer/jane"]');
    expect(profileLink).toBeTruthy();
    expect(profileLink?.textContent).toContain('Jane Doe');
  });

  it('renders date • session time when a session time is present', () => {
    const { getByText } = render(<EventCard {...baseProps} sessionTime="09:30" />);
    // es locale → 24h "9:30"
    expect(getByText('9:30')).toBeTruthy();
  });

  it('renders only the date when there is no session time', () => {
    const { queryByText } = render(<EventCard {...baseProps} sessionTime={null} />);
    expect(queryByText('9:30')).toBeNull();
  });

  // Regression (T-123): a priority cover is the grid's LCP candidate — it must
  // be visible from the first paint (no `opacity-0` gate waiting for hydration
  // + onLoad), with the loading skeleton BEHIND it in DOM order so progressive
  // decoding paints over the placeholder. Non-priority covers keep the fade.
  it('does not gate a priority cover behind onLoad; skeleton sits behind the image', () => {
    const { container } = render(<EventCard {...baseProps} priority />);
    const img = container.querySelector('img[alt="City Marathon cover"]');
    expect(img).not.toBeNull();
    expect(img?.className).not.toContain('opacity-0');

    const skeleton = container.querySelector('[data-slot="skeleton"]');
    expect(skeleton).not.toBeNull();
    // Skeleton before the image in DOM order → painted behind it.
    expect(
      img && skeleton && skeleton.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the opacity fade for non-priority covers while loading', () => {
    const { container } = render(<EventCard {...baseProps} />);
    const img = container.querySelector('img[alt="City Marathon cover"]');
    expect(img?.className).toContain('opacity-0');
  });

  it('hides share/save/photographer row in owner mode', () => {
    const { queryByTestId, container } = render(
      <EventCard
        {...baseProps}
        photographer={undefined}
        ownerStats={{ isPublic: true, privateLabel: 'Privado' }}
      />,
    );
    expect(queryByTestId('save-btn')).toBeNull();
    expect(queryByTestId('share-btn')).toBeNull();
    expect(container.querySelector('a[href^="/es/photographer/"]')).toBeNull();
  });
});
