/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventDetailsCard } from '@/app/[lang]/dashboard/photographer/events/[id]/event-details-card';

afterEach(cleanup);

const t = {
  title: 'Event details',
  eventType: 'Event type',
  typeSolo: 'Solo',
  typeCollaborative: 'Collaborative',
  typeOrganizer: 'Organizer',
  activity: 'Activity',
  date: 'Date',
  location: 'Location',
  pricePerPhoto: 'Price per photo',
  free: 'Free',
  visibility: 'Visibility',
  public: 'Public',
  private: 'Private',
  watermark: 'Watermark',
  aiMatching: 'AI face matching',
  bibDetection: 'Bib number detection',
  containsMinors: 'Contains minors',
  uploadApproval: 'Upload approval required',
  guestUpload: 'Guest upload allowed',
  enabled: 'Enabled',
  disabled: 'Disabled',
  yes: 'Yes',
  no: 'No',
  settings: 'Settings',
  showMore: 'Show more details',
  showLess: 'Show less',
  edit: 'Edit',
} as const;

const baseProps = {
  t,
  type: 'solo' as const,
  isCollaborative: false,
  activityLabel: 'Running',
  date: 'Jun 12 2026',
  location: 'Madrid, Spain',
  pricePerPhoto: 5 as number | null,
  isPublic: true,
  watermarkEnabled: true,
  aiMatchingEnabled: false,
  bibDetectionEnabled: false,
  containsMinors: false,
  requireUploadApproval: false,
  allowGuestUpload: false,
  editHref: '/en/dashboard/photographer/events/e1/edit',
};

describe('EventDetailsCard', () => {
  it('renders all core info fields and the edit link', () => {
    render(<EventDetailsCard {...baseProps} />);

    // Info grid — no "show more" expander gating these anymore.
    expect(screen.getByText('Jun 12 2026')).toBeTruthy();
    expect(screen.getByText('Madrid, Spain')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Solo')).toBeTruthy();
    expect(screen.getByText('$5.00')).toBeTruthy();
    expect(screen.getByText('Public')).toBeTruthy();

    const edit = screen.getByRole('link', { name: /Edit/ });
    expect(edit.getAttribute('href')).toBe('/en/dashboard/photographer/events/e1/edit');
  });

  it('shows every configuration toggle as a badge, always visible (no expander)', () => {
    render(<EventDetailsCard {...baseProps} />);
    // The old "Show more details" collapsible is gone.
    expect(screen.queryByText('Show more details')).toBeNull();
    for (const label of [
      'Watermark',
      'AI face matching',
      'Bib number detection',
      'Contains minors',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders the guest-upload toggle only for collaborative events', () => {
    const { rerender } = render(<EventDetailsCard {...baseProps} />);
    expect(screen.queryByText('Guest upload allowed')).toBeNull();

    rerender(<EventDetailsCard {...baseProps} isCollaborative type="collaborative" />);
    expect(screen.getByText('Guest upload allowed')).toBeTruthy();
  });

  it('shows the free label when there is no price', () => {
    render(<EventDetailsCard {...baseProps} pricePerPhoto={null} />);
    expect(screen.getByText('Free')).toBeTruthy();
  });
});
