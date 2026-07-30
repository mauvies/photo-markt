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

  /**
   * T-212 reversed the T-203 rule here, and the reversal is the point.
   *
   * T-203 had every form echo the stored ladder, because an absent field meant
   * "clear". That made a form which cannot SHOW the ladder responsible for
   * preserving it, and it failed in both directions: a stored ladder the read
   * parser rejects came back as `''` and got deleted by the first unrelated
   * save, and lowering a price from the Info card validated the echoed ladder
   * and threw an error about a field that section does not render.
   *
   * Now only a form that actually edits the ladder speaks about it. Silence
   * means `absent`, and the action leaves the column untouched.
   */
  it('omits the ladder entirely for a form with no ladder editor', () => {
    const fd = buildEventUpdateFormData(
      {
        ...base,
        bundle_tiers: [{ minQuantity: 3, totalPriceCents: 1200 }],
        bundle_all_photos_cents: 2500,
      },
      { includeBundlePricing: false },
    );
    // Absent — NOT `''`, which would mean "clear it".
    expect(fd.has('bundle_tiers')).toBe(false);
    expect(fd.has('bundle_all_photos_cents')).toBe(false);
  });

  it('sends the ladder from the form that does edit it', () => {
    const fd = buildEventUpdateFormData(
      {
        ...base,
        bundle_tiers: [
          { minQuantity: 3, totalPriceCents: 1200 },
          { minQuantity: 8, totalPriceCents: 2000 },
        ],
        bundle_all_photos_cents: 2500,
      },
      { includeBundlePricing: true },
    );
    expect(JSON.parse(fd.get('bundle_tiers') as string)).toEqual([
      { minQuantity: 3, totalPriceCents: 1200 },
      { minQuantity: 8, totalPriceCents: 2000 },
    ]);
    expect(fd.get('bundle_all_photos_cents')).toBe('2500');
  });

  it('lets the pricing form clear the ladder with an explicit empty value', () => {
    const fd = buildEventUpdateFormData(
      { ...base, bundle_tiers: null, bundle_all_photos_cents: null },
      { includeBundlePricing: true },
    );
    // Present-but-empty is how "the photographer removed every pack" travels,
    // and it stays distinguishable from the absent case above.
    expect(fd.get('bundle_tiers')).toBe('');
    expect(fd.get('bundle_all_photos_cents')).toBe('');
  });
});
