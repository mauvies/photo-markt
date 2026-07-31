/** @vitest-environment happy-dom */

/**
 * Regression tests for T-211: the watermark switch used to lie.
 *
 * Reported symptom: "I turn watermarks on when editing an event's settings and
 * after saving it isn't on". It was not a failed save — the server forces
 * `watermark_enabled` to false on a private non-organizer event on purpose (the
 * share code is the protection). The form simply never implemented that rule:
 * the switch rendered enabled and toggleable on a private event, and the save
 * silently discarded the choice.
 *
 * The only client-side trace of the rule was the `is_public` toggle pushing
 * `watermark_enabled` alongside it — which never runs on an event that was
 * ALREADY private when the form opened, i.e. the reported case.
 */

import { useForm } from '@tanstack/react-form';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventFormFields } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/components/event-form-fields';
import type { FormValues } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-schema';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

afterEach(cleanup);

const PRIVATE_NOTE = 'Private events are protected by the share code';

const translations = {
  watermarkPrivateNote: PRIVATE_NOTE,
  priceLabel: 'Price per photo',
} as const;

function Harness({
  isPublic,
  watermarkEnabled,
  eventType,
  section = 'settings',
}: {
  isPublic: boolean;
  watermarkEnabled: boolean;
  eventType: string;
  section?: 'all' | 'settings';
}) {
  const form = useForm({
    defaultValues: {
      name: 'Event',
      activity: 'SURF',
      date: '2026-06-15',
      session_time: '',
      session_end_time: '',
      city: 'Barcelona',
      state: 'Catalonia',
      country: 'ES',
      is_public: isPublic,
      watermark_enabled: watermarkEnabled,
      is_collaborative: false,
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
    <TranslationsProvider translations={translations}>
      <EventFormFields
        // biome-ignore lint/suspicious/noExplicitAny: the component's own prop type erases the form generics
        form={form as any}
        submitAttempted={false}
        datePopoverOpen={false}
        setDatePopoverOpen={vi.fn()}
        section={section}
        eventType={eventType}
      />
    </TranslationsProvider>
  );
}

function watermarkSwitch(): HTMLElement {
  const el = document.getElementById('watermark_enabled');
  if (!el) throw new Error('watermark switch not rendered');
  return el;
}

describe('watermark switch obeys the rule the save applies (T-211)', () => {
  it('is disabled and shown off on a private solo event, even with the stored flag on', () => {
    // The reported case. `watermark_enabled` is true in form state (a legacy
    // row, or a value the user just clicked), yet the save would write false.
    render(<Harness isPublic={false} watermarkEnabled={true} eventType="solo" />);

    const toggle = watermarkSwitch();
    expect(toggle.getAttribute('disabled')).not.toBeNull();
    expect(toggle.getAttribute('data-state')).toBe('unchecked');
    expect(screen.getByText(PRIVATE_NOTE)).toBeTruthy();
  });

  it('stays enabled and toggleable on a public event', () => {
    render(<Harness isPublic={true} watermarkEnabled={true} eventType="solo" />);

    const toggle = watermarkSwitch();
    expect(toggle.getAttribute('disabled')).toBeNull();
    expect(toggle.getAttribute('data-state')).toBe('checked');
    expect(screen.queryByText(PRIVATE_NOTE)).toBeNull();
  });

  it('keeps the switch available on a private ORGANIZER event', () => {
    // Organizer events are always private but keep their watermark — disabling
    // the switch for them would be the mirror-image bug.
    render(<Harness isPublic={false} watermarkEnabled={true} eventType="organizer" />);

    const toggle = watermarkSwitch();
    expect(toggle.getAttribute('disabled')).toBeNull();
    expect(toggle.getAttribute('data-state')).toBe('checked');
  });

  it('reacts immediately when visibility is switched to private in the same form', () => {
    // The `all` section renders both toggles, so this exercises the live
    // coupling rather than the initial render.
    render(<Harness isPublic={true} watermarkEnabled={true} eventType="solo" section="all" />);
    expect(watermarkSwitch().getAttribute('disabled')).toBeNull();

    const visibility = document.getElementById('is_public');
    if (!visibility) throw new Error('visibility switch not rendered');
    fireEvent.click(visibility);

    expect(watermarkSwitch().getAttribute('disabled')).not.toBeNull();
    expect(watermarkSwitch().getAttribute('data-state')).toBe('unchecked');
  });
});
