/** @vitest-environment happy-dom */

/**
 * Regression tests for T-206: the event edit form rendered English in `/es`.
 *
 * `EventFormFields` — the field group shared by the full `/edit` page and the
 * section-scoped editor — hardcoded every one of its labels, descriptions,
 * placeholders and validation messages in English, in an app whose rule is that
 * no visible string may be hardcoded. A Spanish photographer editing an event
 * saw "Event Visibility", "Watermark on Photos", "Collaborative Event" and so
 * on, right next to correctly translated copy.
 *
 * Every key asserted here already existed in the `newEvent` namespace — the
 * create wizard renders the same fields and was translated all along — so the
 * fix wired up existing translations rather than inventing new ones.
 */

import { useForm } from '@tanstack/react-form';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventFormFields } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/components/event-form-fields';
import type { FormValues } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-schema';
import esDict from '@/dictionaries/es.json';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

afterEach(cleanup);

const es = esDict.newEvent;

function Harness({ section }: { section: 'info' | 'settings' }) {
  const form = useForm({
    defaultValues: {
      name: 'Evento',
      activity: 'SURF',
      date: '2026-06-15',
      session_time: '',
      session_end_time: '',
      city: 'Barcelona',
      state: 'Catalunya',
      country: 'ES',
      is_public: true,
      watermark_enabled: true,
      is_collaborative: true,
      allow_guest_upload: true,
      require_upload_approval: false,
      price_per_photo: 5,
      ai_matching_enabled: false,
      contains_minors: false,
      bib_detection_enabled: false,
      reveal_gate_enabled: false,
      bundle_tiers: null,
      bundle_all_photos_cents: null,
    } as FormValues,
  });

  return (
    <TranslationsProvider translations={es}>
      <EventFormFields
        // biome-ignore lint/suspicious/noExplicitAny: the component's own prop type erases the form generics
        form={form as any}
        submitAttempted={false}
        datePopoverOpen={false}
        setDatePopoverOpen={vi.fn()}
        section={section}
        eventType="solo"
      />
    </TranslationsProvider>
  );
}

describe('the edit form speaks the visitor’s language (T-206)', () => {
  it('translates the info fields instead of hardcoding English', () => {
    render(<Harness section="info" />);

    for (const label of [
      es.nameLabel,
      es.activityLabel,
      es.locationLabel,
      es.dateLabel,
      es.sessionTimeLabel,
      es.sessionEndTimeLabel,
      es.visibilityLabel,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    // The exact English strings that used to be baked in must be gone.
    for (const english of ['Name or place', 'Activity', 'Location', 'Event Visibility']) {
      expect(screen.queryByText(english)).toBeNull();
    }
  });

  it('translates the settings toggles instead of hardcoding English', () => {
    render(<Harness section="settings" />);

    for (const label of [
      es.watermarkLabel,
      es.watermarkDesc,
      es.collaborativeLabel,
      es.collaborativeDesc,
      // Rendered because the harness starts collaborative.
      es.allowGuestUploadLabel,
      es.requireApprovalLabel,
      es.requireApprovalDesc,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    for (const english of [
      'Watermark on Photos',
      'Collaborative Event',
      'Allow guest uploads',
      'Require approval',
      'Hold uploads as pending until you approve them',
    ]) {
      expect(screen.queryByText(english)).toBeNull();
    }
  });

  it('uses translated placeholders and empty-state copy', () => {
    render(<Harness section="info" />);

    const location = document.getElementById('city') as HTMLInputElement | null;
    expect(location?.getAttribute('placeholder')).toBe(es.locationSearchPlaceholder);

    const name = document.getElementById('name') as HTMLInputElement | null;
    expect(name?.getAttribute('placeholder')).toBe(es.namePlaceholder);
  });
});
