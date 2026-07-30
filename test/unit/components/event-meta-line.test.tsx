/** @vitest-environment happy-dom */
/**
 * T-103 — the event metadata line: date · city · photographer · price.
 * Pins the photographer link (present, linked to the public profile,
 * positioned before the price) and the locale-aware date format.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventMetaLine } from '@/components/event-meta-line';

// Noon UTC keeps the calendar day stable regardless of the runner's timezone.
const JUNE_6 = '2026-06-06T12:00:00.000Z';

afterEach(cleanup);

describe('EventMetaLine', () => {
  it('links the photographer name to their public profile', () => {
    render(
      <EventMetaLine
        date={JUNE_6}
        city="lisbon"
        locale="en"
        perPhotoLabel="per photo"
        pricePerPhoto={10}
        photographerName="janedoe"
      />,
    );

    const link = screen.getByRole('link', { name: '@janedoe' });
    expect(link.getAttribute('href')).toBe('/en/photographer/janedoe');
  });

  it('positions the photographer before the price', () => {
    const { container } = render(
      <EventMetaLine
        date={JUNE_6}
        city="lisbon"
        locale="en"
        perPhotoLabel="per photo"
        pricePerPhoto={10}
        photographerName="janedoe"
      />,
    );

    const text = container.textContent ?? '';
    expect(text.indexOf('@janedoe')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('@janedoe')).toBeLessThan(text.indexOf('per photo'));
    expect(text).toContain('€10.00 per photo');
  });

  it('formats the date per locale (English month-day-year)', () => {
    const { container } = render(
      <EventMetaLine date={JUNE_6} city="lisbon" locale="en" perPhotoLabel="per photo" />,
    );
    expect(container.textContent).toContain('June 6, 2026');
  });

  it('formats the date per locale (Spanish day-month-year, not the English abbreviation)', () => {
    const { container } = render(
      <EventMetaLine date={JUNE_6} city="lisbon" locale="es" perPhotoLabel="por foto" />,
    );
    expect(container.textContent).toContain('6 de junio de 2026');
    expect(container.textContent).not.toContain('Jun ');
  });

  it('omits the photographer segment cleanly when no name is resolved', () => {
    const { container } = render(
      <EventMetaLine
        date={JUNE_6}
        city="lisbon"
        locale="en"
        perPhotoLabel="per photo"
        pricePerPhoto={10}
      />,
    );

    expect(screen.queryByRole('link')).toBeNull();
    // No dangling "@" and no doubled separators.
    expect(container.textContent).not.toContain('@');
    expect(container.textContent).not.toContain('• •');
  });

  it('shows the session time (after the date) when provided (T-106)', () => {
    const { container } = render(
      <EventMetaLine
        date={JUNE_6}
        sessionTime="09:30"
        city="lisbon"
        locale="en"
        perPhotoLabel="per photo"
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/9:30\s?AM/i);
    // Between the date and the city.
    expect(text.indexOf('June 6, 2026')).toBeLessThan(text.search(/9:30/));
    expect(text.search(/9:30/)).toBeLessThan(text.indexOf('Lisbon'));
  });

  it('shows the session as a start–end range when both times are provided (T-180)', () => {
    const { container } = render(
      <EventMetaLine
        date={JUNE_6}
        sessionTime="09:30"
        sessionEndTime="12:00"
        city="lisbon"
        locale="es"
        perPhotoLabel="por foto"
      />,
    );
    // es locale → 24-hour; the range joins the two ends with an en dash.
    expect(container.textContent).toContain('9:30 – 12:00');
  });

  it('shows only the start when the end is absent (T-180 falls back to T-106)', () => {
    const { container } = render(
      <EventMetaLine
        date={JUNE_6}
        sessionTime="09:30"
        city="lisbon"
        locale="es"
        perPhotoLabel="por foto"
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('9:30');
    expect(text).not.toContain('–');
  });

  it('omits the session time segment when absent (T-106)', () => {
    const { container } = render(
      <EventMetaLine date={JUNE_6} city="lisbon" locale="en" perPhotoLabel="per photo" />,
    );
    expect(container.textContent).not.toMatch(/\d:\d{2}/);
  });

  it('omits the price segment when pricePerPhoto is null', () => {
    const { container } = render(
      <EventMetaLine
        date={JUNE_6}
        city="lisbon"
        locale="en"
        perPhotoLabel="per photo"
        pricePerPhoto={null}
        photographerName="janedoe"
      />,
    );

    expect(container.textContent).not.toContain('per photo');
    expect(container.textContent).not.toContain('$');
  });
});

/**
 * T-204 — exactly ONE surface quotes an event's price.
 *
 * Once volume pricing is configured, `EventPricingSection` renders directly below
 * this line and states the unit price AND every package. Repeating the unit price
 * here is redundant, and on an event whose selling point is the package price it
 * is also the least relevant number to lead with. With no schedule the section
 * renders nothing, so the line keeps the price — dropping it unconditionally
 * would lose it altogether.
 */
describe('EventMetaLine price segment vs. volume pricing', () => {
  const base = {
    date: JUNE_6,
    city: 'lisbon',
    locale: 'en',
    perPhotoLabel: 'per photo',
    pricePerPhoto: 3,
    photographerName: 'janedoe',
  } as const;

  it('keeps the unit price when the event has no volume pricing', () => {
    const { container } = render(<EventMetaLine {...base} />);
    expect(container.textContent).toContain('€3.00 per photo');
  });

  it('drops the unit price once a package ladder is configured', () => {
    const { container } = render(
      <EventMetaLine {...base} bundleTiers={[{ minQuantity: 3, totalPriceCents: 720 }]} />,
    );

    expect(container.textContent).not.toContain('per photo');
    expect(container.textContent).not.toContain('€3.00');
    // The rest of the line is untouched.
    expect(container.textContent).toContain('June 6, 2026');
    expect(container.textContent).toContain('Lisbon');
    expect(screen.getByRole('link', { name: '@janedoe' })).toBeDefined();
  });

  it('drops the unit price for an "all photos" ceiling with no rungs', () => {
    const { container } = render(<EventMetaLine {...base} bundleAllPhotosCents={2500} />);
    expect(container.textContent).not.toContain('per photo');
  });

  it('keeps the unit price when the ladder is empty or the ceiling is zero', () => {
    const { container } = render(
      <EventMetaLine {...base} bundleTiers={[]} bundleAllPhotosCents={0} />,
    );
    expect(container.textContent).toContain('€3.00 per photo');
  });

  it('leaves no dangling separator where the price used to be', () => {
    const { container } = render(
      <EventMetaLine {...base} bundleTiers={[{ minQuantity: 3, totalPriceCents: 720 }]} />,
    );

    const text = (container.textContent ?? '').trim();
    expect(text).not.toContain('• •');
    expect(text.endsWith('•')).toBe(false);
  });
});
