/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EventTabs,
  parseEventTab,
} from '@/app/[lang]/dashboard/photographer/events/[id]/event-tabs';

afterEach(cleanup);

const labels = { photos: 'Photos', details: 'Details', share: 'Share' };
const slots = {
  photos: <div>PHOTOS_SLOT</div>,
  details: <div>DETAILS_SLOT</div>,
  share: <div>SHARE_SLOT</div>,
};

describe('parseEventTab', () => {
  it('defaults to photos when the param is missing or unknown', () => {
    expect(parseEventTab(undefined)).toBe('photos');
    expect(parseEventTab('overview')).toBe('photos');
    expect(parseEventTab('')).toBe('photos');
  });

  it('resolves the known top-level tabs', () => {
    expect(parseEventTab('photos')).toBe('photos');
    expect(parseEventTab('details')).toBe('details');
    expect(parseEventTab('share')).toBe('share');
  });

  it('takes the first value from an array param', () => {
    expect(parseEventTab(['details', 'share'])).toBe('details');
  });
});

describe('EventTabs', () => {
  it('renders all three top-level triggers and lands on Photos by default', () => {
    render(<EventTabs initialTab="photos" labels={labels} {...slots} />);

    expect(screen.getByRole('tab', { name: 'Photos' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Details' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Share' })).toBeTruthy();

    // Photos is the active panel; the other slots are not rendered/visible.
    expect(screen.getByText('PHOTOS_SLOT')).toBeTruthy();
    expect(screen.queryByText('DETAILS_SLOT')).toBeNull();
  });

  it('honours the initial tab from the URL (?tab=details selects Details)', () => {
    render(<EventTabs initialTab="details" labels={labels} {...slots} />);

    expect(screen.getByText('DETAILS_SLOT')).toBeTruthy();
    expect(screen.queryByText('PHOTOS_SLOT')).toBeNull();
  });

  it('pushes the active tab to the URL on change so it survives a refresh', () => {
    render(<EventTabs initialTab="photos" labels={labels} {...slots} />);

    // Radix tabs use automatic activation (activate on focus); focus then click
    // mirrors a real pointer interaction in happy-dom.
    const shareTrigger = screen.getByRole('tab', { name: 'Share' });
    fireEvent.focus(shareTrigger);
    fireEvent.click(shareTrigger);

    expect(screen.getByText('SHARE_SLOT')).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get('tab')).toBe('share');
  });
});
