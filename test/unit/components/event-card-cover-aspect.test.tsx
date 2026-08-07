/**
 * @vitest-environment happy-dom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventCardSkeleton } from '@/components/event-card-skeleton';
import { EVENT_CARD_COVER_ASPECT } from '@/lib/event-card-aspect';

/**
 * T-233. The event card's cover ratio and the skeleton that reserves space for
 * it must be the same value.
 *
 * Before this they were the literal `aspect-[4/3]` typed out in two files and
 * kept in step by hand. Drift there is not cosmetic: the skeleton reserves one
 * height, the image paints another, and the result is layout shift on the LCP
 * element of the home and explore pages (T-123/T-124) — visible to users,
 * invisible to a reviewer reading either file alone.
 */
describe('event card cover aspect (T-233)', () => {
  it('is a complete Tailwind class literal, never interpolated', () => {
    // Tailwind scans source for whole class strings: a value built by
    // interpolation generates no CSS and silently renders with no ratio.
    expect(EVENT_CARD_COVER_ASPECT).toMatch(/^aspect-\[\d+\/\d+\]$/);
  });

  it('is what the skeleton reserves', () => {
    const { container } = render(<EventCardSkeleton />);
    expect(container.innerHTML).toContain(EVENT_CARD_COVER_ASPECT);
  });

  it('is what the card applies to its cover container', () => {
    // Source-level on purpose: rendering EventCard needs an event fixture, a
    // router and next/image, and none of that is what could break here — the
    // failure mode is one of the two files being edited without the other.
    const source = require('node:fs').readFileSync('src/components/event-card.tsx', 'utf8');
    expect(source).toContain('EVENT_CARD_COVER_ASPECT');
    expect(source).not.toMatch(/aspect-\[\d+\/\d+\]/);
  });
});
