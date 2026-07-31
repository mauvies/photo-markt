/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventSettingsCard } from '@/app/[lang]/dashboard/photographer/events/[id]/event-settings-card';

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
  editEventTitle: 'Edit event',
  editEventSubtitle: 'x',
  editPhotosTitle: 'Photos',
  editPhotosSubtitle: 'x',
  editSavedInstantlyBadge: 'Saved automatically',
  editCoverSavedInstantly: 'x',
  editUnsavedHint: 'x',
  saveChanges: 'Save changes',
  saving: 'Saving…',
  cancel: 'Cancel',
  edit: 'Edit',
} as const;

const baseProps = {
  t,
  isCollaborative: false,
  watermarkEnabled: true,
  aiMatchingEnabled: false,
  bibDetectionEnabled: false,
  containsMinors: false,
  requireUploadApproval: false,
  allowGuestUpload: false,
  editHref: '/en/dashboard/photographer/events/e1/edit?section=settings',
};

describe('EventSettingsCard', () => {
  it('renders every configuration toggle as a badge under the settings title', () => {
    render(<EventSettingsCard {...baseProps} />);
    expect(screen.getByText('Event settings')).toBeTruthy();
    for (const label of [
      'Watermark',
      'AI face matching',
      'Bib number detection',
      'Upload approval required',
      'Contains minors',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('links Edit to the scoped settings-edit page', () => {
    render(<EventSettingsCard {...baseProps} />);
    const edit = screen.getByRole('link', { name: /Edit/ });
    expect(edit.getAttribute('href')).toBe(
      '/en/dashboard/photographer/events/e1/edit?section=settings',
    );
  });

  it('renders the guest-upload toggle only for collaborative events', () => {
    const { rerender } = render(<EventSettingsCard {...baseProps} />);
    expect(screen.queryByText('Guest upload allowed')).toBeNull();
    rerender(<EventSettingsCard {...baseProps} isCollaborative allowGuestUpload />);
    expect(screen.getByText('Guest upload allowed')).toBeTruthy();
  });
});
