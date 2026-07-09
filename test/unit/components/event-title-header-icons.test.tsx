/** @vitest-environment happy-dom */
/**
 * T-082: Save (heart) and Share icons moved from a labeled button below the
 * event description to icon-only buttons with tooltips next to the event
 * title. Guards that both render icon-only (no visible label text, tooltip
 * only via aria-label) and that Share always shares the given event URL
 * (never the photo URL / a dashboard route).
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { toggle, shareUrl } = vi.hoisted(() => ({
  toggle: vi.fn(async () => ({ ok: true, saved: true })),
  shareUrl: vi.fn(),
}));
vi.mock('@/hooks/use-saved-events', () => ({
  useSavedEvents: () => ({
    isTalent: true,
    isSaved: () => false,
    toggle,
  }),
}));
vi.mock('@/lib/share-url', () => ({ shareUrl }));

import { EventSaveButton } from '@/components/event-save-button';
import { EventShareButton } from '@/components/event-share-button';
import { SavedEventsLabelsProvider } from '@/components/saved-events-labels-provider';

const labels = {
  save: 'Save event',
  saved: 'Saved',
  savedToast: 'Event saved',
  removedToast: 'Event removed',
  failedSave: 'Failed to save event',
  failedRemove: 'Failed to remove event',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('event title header icons (T-082)', () => {
  it('renders the Save icon icon-only, with the tooltip as the accessible name', () => {
    render(
      <SavedEventsLabelsProvider labels={labels}>
        <EventSaveButton eventId="evt-1" variant="icon" />
      </SavedEventsLabelsProvider>,
    );

    const button = screen.getByRole('button', { name: 'Save event' });
    expect(button.textContent).toBe('');
    expect(screen.queryByText('Save event')).toBeNull();
  });

  it('toggles the saved state when the Save icon is clicked', async () => {
    render(
      <SavedEventsLabelsProvider labels={labels}>
        <EventSaveButton eventId="evt-1" variant="icon" />
      </SavedEventsLabelsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));

    await waitFor(() => expect(toggle).toHaveBeenCalledWith('evt-1'));
  });

  it('renders the Share icon icon-only and shares the given event URL', async () => {
    render(
      <EventShareButton
        eventName="Marathon Madrid 2026"
        eventUrl="https://example.com/en/events/marathon-2026"
        tooltip="Share"
      />,
    );

    const button = screen.getByRole('button', { name: 'Share' });
    expect(button.textContent).toBe('');

    fireEvent.click(button);

    await waitFor(() =>
      expect(shareUrl).toHaveBeenCalledWith(
        'Marathon Madrid 2026',
        'https://example.com/en/events/marathon-2026',
      ),
    );
  });
});
