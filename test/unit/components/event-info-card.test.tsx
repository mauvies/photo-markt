/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventInfoCard } from '@/app/[lang]/dashboard/photographer/events/[id]/event-info-card';

afterEach(cleanup);

const t = {
  infoTitle: 'Event info',
  settingsTitle: 'Event settings',
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
  editInfoTitle: 'Edit event info',
  editSettingsTitle: 'Edit event settings',
  editInfoSubtitle: 'x',
  editSettingsSubtitle: 'x',
  saveChanges: 'Save changes',
  saving: 'Saving…',
  cancel: 'Cancel',
  edit: 'Edit',
} as const;

const baseProps = {
  t,
  type: 'solo' as const,
  activityLabel: 'Running',
  date: 'Jun 12 2026',
  location: 'Madrid, Spain',
  pricePerPhoto: 5 as number | null,
  isPublic: true,
  editHref: '/en/dashboard/photographer/events/e1/edit?section=info',
};

describe('EventInfoCard', () => {
  it('renders the core info fields under the info title', () => {
    render(<EventInfoCard {...baseProps} />);
    expect(screen.getByText('Event info')).toBeTruthy();
    expect(screen.getByText('Jun 12 2026')).toBeTruthy();
    expect(screen.getByText('Madrid, Spain')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Solo')).toBeTruthy();
    expect(screen.getByText('$5.00')).toBeTruthy();
    expect(screen.getByText('Public')).toBeTruthy();
  });

  it('links Edit to the scoped info-edit page', () => {
    render(<EventInfoCard {...baseProps} />);
    const edit = screen.getByRole('link', { name: /Edit/ });
    expect(edit.getAttribute('href')).toBe(
      '/en/dashboard/photographer/events/e1/edit?section=info',
    );
  });

  it('shows the free label when there is no price', () => {
    render(<EventInfoCard {...baseProps} pricePerPhoto={null} />);
    expect(screen.getByText('Free')).toBeTruthy();
  });

  it('does NOT render the settings toggles (those live in the settings card)', () => {
    render(<EventInfoCard {...baseProps} />);
    expect(screen.queryByText('AI face matching')).toBeNull();
    expect(screen.queryByText('Watermark')).toBeNull();
  });
});
