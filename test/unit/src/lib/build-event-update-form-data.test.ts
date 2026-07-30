import { describe, expect, it } from 'vitest';
import type { FormValues } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-schema';
import { buildEventUpdateFormData } from '@/app/[lang]/dashboard/photographer/events/[id]/edit/event-form-data';

const base: FormValues = {
  name: '  Summer Marathon  ',
  activity: 'running' as FormValues['activity'],
  date: '2026-06-12',
  session_time: '08:30',
  session_end_time: '11:00',
  city: 'Madrid',
  state: 'Madrid',
  country: 'Spain',
  is_public: true,
  watermark_enabled: true,
  is_collaborative: false,
  allow_guest_upload: true,
  require_upload_approval: false,
  price_per_photo: 5,
  ai_matching_enabled: true,
  contains_minors: false,
  bib_detection_enabled: false,
  reveal_gate_enabled: true,
  bundle_tiers: null,
  bundle_all_photos_cents: null,
};

describe('buildEventUpdateFormData', () => {
  it('serializes the full event payload so unedited fields ride along', () => {
    // This is the invariant that makes section-scoped editing safe: even when a
    // scoped form only edited (say) the info fields, EVERY field is still sent
    // at its current value, so updateEventAction never resets the untouched
    // settings back to their defaults.
    const fd = buildEventUpdateFormData(base);
    expect(fd.get('name')).toBe('Summer Marathon'); // trimmed
    expect(fd.get('activity')).toBe('running');
    expect(fd.get('date')).toBe('2026-06-12');
    expect(fd.get('session_time')).toBe('08:30');
    expect(fd.get('session_end_time')).toBe('11:00');
    expect(fd.get('city')).toBe('Madrid');
    expect(fd.get('state')).toBe('Madrid');
    expect(fd.get('country')).toBe('Spain');
    expect(fd.get('is_public')).toBe('true');
    expect(fd.get('watermark_enabled')).toBe('true');
    expect(fd.get('is_collaborative')).toBe('false');
    expect(fd.get('allow_guest_upload')).toBe('true');
    expect(fd.get('require_upload_approval')).toBe('false');
    expect(fd.get('ai_matching_enabled')).toBe('true');
    expect(fd.get('bib_detection_enabled')).toBe('false');
    expect(fd.get('reveal_gate_enabled')).toBe('true');
    expect(fd.get('contains_minors')).toBe('false');
    expect(fd.get('price_per_photo')).toBe('5');
  });

  it('omits price when null and always sends session_time/session_end_time (even empty)', () => {
    const fd = buildEventUpdateFormData({
      ...base,
      price_per_photo: null,
      session_time: '',
      session_end_time: '',
    });
    expect(fd.get('price_per_photo')).toBeNull();
    // session_time/session_end_time are always present so clearing persists as
    // null server-side (T-106/T-180).
    expect(fd.get('session_time')).toBe('');
    expect(fd.get('session_end_time')).toBe('');
  });

  it('always sends the bundle ladder, so editing another section cannot wipe it (T-203)', () => {
    // The server treats an absent `bundle_tiers` as "clear the ladder". A
    // section-scoped form edits (say) the info card but still submits the whole
    // event, so it MUST echo the stored ladder — otherwise renaming an event
    // would silently delete its volume pricing.
    const withLadder = buildEventUpdateFormData({
      ...base,
      bundle_tiers: [
        { minQuantity: 3, totalPriceCents: 1200 },
        { minQuantity: 8, totalPriceCents: 2000 },
      ],
    });
    expect(JSON.parse(withLadder.get('bundle_tiers') as string)).toEqual([
      { minQuantity: 3, totalPriceCents: 1200 },
      { minQuantity: 8, totalPriceCents: 2000 },
    ]);

    // And a genuinely absent ladder is sent as empty rather than omitted, so
    // clearing one persists.
    const withoutLadder = buildEventUpdateFormData({ ...base, bundle_tiers: null });
    expect(withoutLadder.get('bundle_tiers')).toBe('');
  });
});
