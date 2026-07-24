/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventShareTab } from '@/app/[lang]/dashboard/photographer/events/[id]/event-share-tab';

afterEach(cleanup);

const labels = {
  heading: 'Share this event',
  description: 'Send this link to athletes so they can find their photos from "{eventName}".',
  privateNote: 'This link includes the private access code.',
  copy: 'Copy link',
  copied: 'Copied!',
  shareTooltip: 'Share',
};

describe('EventShareTab', () => {
  it('shows the full shareable URL as selectable text', () => {
    render(
      <EventShareTab
        eventName="Summer Marathon"
        shareUrl="https://photomarkt.com/es/events/summer-marathon"
        isPublic
        labels={labels}
      />,
    );
    expect(screen.getByText('https://photomarkt.com/es/events/summer-marathon')).toBeTruthy();
    // Description interpolates the event name.
    expect(screen.getByText(/Summer Marathon/)).toBeTruthy();
  });

  it('copies the URL and shows transient confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <EventShareTab
        eventName="Summer Marathon"
        shareUrl="https://photomarkt.com/es/events/ABC123"
        isPublic={false}
        labels={labels}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith('https://photomarkt.com/es/events/ABC123');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeTruthy());
  });

  it('renders the private access note only for private events', () => {
    const { rerender } = render(
      <EventShareTab
        eventName="Marathon"
        shareUrl="https://photomarkt.com/es/events/ABC123"
        isPublic={false}
        labels={labels}
      />,
    );
    expect(screen.getByText('This link includes the private access code.')).toBeTruthy();

    rerender(
      <EventShareTab
        eventName="Marathon"
        shareUrl="https://photomarkt.com/es/events/slug"
        isPublic
        labels={labels}
      />,
    );
    expect(screen.queryByText('This link includes the private access code.')).toBeNull();
  });
});
