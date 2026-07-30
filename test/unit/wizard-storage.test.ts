/** @vitest-environment happy-dom */

/**
 * Regression tests for T-052: wizard step-1 config (AI matching / BIB
 * detection) lost after page refresh.
 *
 * readStoredState() parses the sessionStorage draft and returns the stored
 * FormValues. These tests verify that boolean step-1 flags survive the
 * serialization round-trip so the hydration effect can restore them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StepNumber } from '@/app/[lang]/dashboard/photographer/events/new/components/wizard-steps';
import type { FormValues } from '@/app/[lang]/dashboard/photographer/events/new/wizard.schema';
import {
  DRAFT_KEY,
  isResumableDraft,
  readStoredState,
  type StoredWizardState,
} from '@/app/[lang]/dashboard/photographer/events/new/wizard-storage';

// Minimal valid payload — only fields the tests care about need to be present;
// readStoredState falls back to safe defaults for everything else.
function makeDraft(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    values: {
      name: 'Test Event',
      activity: 'RUNNING',
      date: '2026-08-01',
      country: '',
      state: '',
      city: '',
      event_type: 'solo',
      is_public: true,
      watermark_enabled: true,
      is_collaborative: false,
      allow_guest_upload: true,
      require_upload_approval: false,
      price_per_photo: null,
      organizer_fee_per_photo: null,
      ai_matching_enabled: false,
      contains_minors: false,
      bib_detection_enabled: false,
      ...overrides,
    },
    reachedStep: 1,
    returnToStep: null,
  });
}

describe('readStoredState', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('returns null when sessionStorage is empty', () => {
    expect(readStoredState()).toBeNull();
  });

  it('restores ai_matching_enabled=true (regression: T-052)', () => {
    sessionStorage.setItem(DRAFT_KEY, makeDraft({ ai_matching_enabled: true }));
    const result = readStoredState();
    expect(result).not.toBeNull();
    expect(result!.values.ai_matching_enabled).toBe(true);
  });

  it('restores bib_detection_enabled=true (regression: T-052)', () => {
    sessionStorage.setItem(DRAFT_KEY, makeDraft({ bib_detection_enabled: true }));
    const result = readStoredState();
    expect(result).not.toBeNull();
    expect(result!.values.bib_detection_enabled).toBe(true);
  });

  it('restores both ai_matching_enabled and bib_detection_enabled=true together', () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      makeDraft({ ai_matching_enabled: true, bib_detection_enabled: true }),
    );
    const result = readStoredState();
    expect(result).not.toBeNull();
    expect(result!.values.ai_matching_enabled).toBe(true);
    expect(result!.values.bib_detection_enabled).toBe(true);
  });

  it('defaults ai_matching_enabled to false when missing from stored payload', () => {
    const draft = makeDraft();
    const parsed = JSON.parse(draft);
    delete parsed.values.ai_matching_enabled;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(parsed));
    const result = readStoredState();
    expect(result!.values.ai_matching_enabled).toBe(false);
  });

  it('defaults bib_detection_enabled to false when missing from stored payload', () => {
    const draft = makeDraft();
    const parsed = JSON.parse(draft);
    delete parsed.values.bib_detection_enabled;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(parsed));
    const result = readStoredState();
    expect(result!.values.bib_detection_enabled).toBe(false);
  });

  it('returns null for malformed JSON without throwing', () => {
    sessionStorage.setItem(DRAFT_KEY, 'not-json{{{');
    expect(() => readStoredState()).not.toThrow();
    expect(readStoredState()).toBeNull();
  });

  it('restores reachedStep from stored draft', () => {
    const draft = JSON.parse(makeDraft());
    draft.reachedStep = 3;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    const result = readStoredState();
    expect(result!.reachedStep).toBe(3);
  });

  // T-105 split the wizard into 4 numbered steps + a review step (5). Before
  // the range was widened, readStoredState validated reachedStep/returnToStep
  // against 1-4 only, so a draft saved on the review step fell back to 1.
  it('restores reachedStep=5 (review step) — regression: T-105 widened range', () => {
    const draft = JSON.parse(makeDraft());
    draft.reachedStep = 5;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    expect(readStoredState()!.reachedStep).toBe(5);
  });

  it('restores returnToStep=5 (review step) — regression: T-105 widened range', () => {
    const draft = JSON.parse(makeDraft());
    draft.returnToStep = 5;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    expect(readStoredState()!.returnToStep).toBe(5);
  });
});

/**
 * T-059: only a genuine in-progress draft should trigger the "continue or
 * start fresh" prompt — never the empty-defaults draft the persist effect
 * writes on a fresh visit.
 */
const PRISTINE_VALUES: FormValues = {
  name: '',
  activity: 'OTHER',
  date: '',
  session_time: '',
  session_end_time: '',
  country: '',
  state: '',
  city: '',
  event_type: 'solo',
  is_public: true,
  watermark_enabled: true,
  is_collaborative: false,
  allow_guest_upload: true,
  require_upload_approval: false,
  price_per_photo: null,
  bundle_tiers: null,
  bundle_all_photos_cents: null,
  organizer_fee_per_photo: null,
  ai_matching_enabled: false,
  contains_minors: false,
  bib_detection_enabled: false,
  reveal_gate_enabled: false,
};

function draft(
  valueOverrides: Partial<FormValues> = {},
  reachedStep: StepNumber = 1,
): StoredWizardState {
  return {
    values: { ...PRISTINE_VALUES, ...valueOverrides },
    reachedStep,
    returnToStep: null,
  };
}

describe('isResumableDraft', () => {
  it('is false with no stored draft and no picked files (fresh visitor)', () => {
    expect(isResumableDraft(null, false)).toBe(false);
  });

  it('is false for a pristine empty-defaults draft on step 1 (no false prompt)', () => {
    expect(isResumableDraft(draft(), false)).toBe(false);
  });

  it('is true when the user had picked photos, even with empty values', () => {
    expect(isResumableDraft(null, true)).toBe(true);
    expect(isResumableDraft(draft(), true)).toBe(true);
  });

  it('is true once the user advanced past step 1', () => {
    expect(isResumableDraft(draft({}, 2), false)).toBe(true);
    expect(isResumableDraft(draft({}, 4), false)).toBe(true);
  });

  it('is true when a text field was filled', () => {
    expect(isResumableDraft(draft({ name: 'Marathon' }), false)).toBe(true);
    expect(isResumableDraft(draft({ date: '2026-08-01' }), false)).toBe(true);
    expect(isResumableDraft(draft({ city: 'Madrid' }), false)).toBe(true);
    expect(isResumableDraft(draft({ activity: 'SURF' }), false)).toBe(true);
  });

  it('is true when a step-1 toggle diverges from its default', () => {
    expect(isResumableDraft(draft({ ai_matching_enabled: true }), false)).toBe(true);
    expect(isResumableDraft(draft({ bib_detection_enabled: true }), false)).toBe(true);
    expect(isResumableDraft(draft({ contains_minors: true }), false)).toBe(true);
    expect(isResumableDraft(draft({ is_public: false }), false)).toBe(true);
    expect(isResumableDraft(draft({ watermark_enabled: false }), false)).toBe(true);
  });

  it('is true when a different event type or price was chosen', () => {
    expect(isResumableDraft(draft({ event_type: 'collaborative' }), false)).toBe(true);
    expect(isResumableDraft(draft({ event_type: 'organizer' }), false)).toBe(true);
    expect(isResumableDraft(draft({ price_per_photo: 10 }), false)).toBe(true);
    expect(isResumableDraft(draft({ organizer_fee_per_photo: 2 }), false)).toBe(true);
  });

  it('ignores whitespace-only text as pristine', () => {
    expect(isResumableDraft(draft({ name: '   ' }), false)).toBe(false);
  });
});
