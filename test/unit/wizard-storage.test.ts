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
import {
  DRAFT_KEY,
  readStoredState,
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
});
