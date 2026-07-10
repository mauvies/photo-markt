import { activityValues } from './activity-options';
import type { StepNumber } from './components/wizard-steps';
import type { FormValues } from './wizard.schema';

// sessionStorage key — scoped per-tab. The wizard draft is discarded when
// the tab closes, which matches user expectation (no surprise drafts
// resurfacing weeks later). Renamed from the previous localStorage key so
// stale localStorage entries (from earlier hotfix layers) don't get
// mistakenly re-read.
export const DRAFT_KEY = 'photo-markt_event_wizard_draft';
// Side-channel flag: set when the user picks at least one photo. We don't
// store the photos themselves (File objects can't be serialized), but knowing
// that they *had* selected something lets us distinguish a fresh arrival on
// step 3 (no banner) from a refresh that wiped the in-memory File[] (banner).
export const HAD_FILES_KEY = 'photo-markt_event_wizard_had_files';

export type StoredWizardState = {
  values: FormValues;
  reachedStep: StepNumber;
  // When set, the next forward navigation (after Next from an edited step)
  // jumps directly here instead of `currentStep + 1`. Set when the user
  // clicks an Edit button from the step 4 review; cleared after the jump.
  returnToStep: StepNumber | null;
};

/**
 * Whether the stored form values differ from a pristine wizard (matching
 * `EMPTY_DEFAULTS` in `wizard-types.ts`). Kept in sync with those defaults —
 * any field that isn't at its default means the user typed/toggled something.
 * `is_collaborative` is derived from `event_type`, so it's covered by that
 * check and intentionally omitted here.
 */
function draftHasUserInput(v: FormValues): boolean {
  return (
    v.name.trim() !== '' ||
    v.activity !== 'OTHER' ||
    v.date !== '' ||
    v.city.trim() !== '' ||
    v.country.trim() !== '' ||
    v.state.trim() !== '' ||
    v.event_type !== 'solo' ||
    v.is_public !== true ||
    v.watermark_enabled !== true ||
    v.allow_guest_upload !== true ||
    v.require_upload_approval !== false ||
    v.price_per_photo !== null ||
    v.organizer_fee_per_photo !== null ||
    v.ai_matching_enabled !== false ||
    v.contains_minors !== false ||
    v.bib_detection_enabled !== false
  );
}

/**
 * Whether a stored draft represents genuine in-progress work worth offering to
 * resume — as opposed to the empty-defaults draft the persist effect writes on
 * a fresh visit. Drives the "continue or start fresh" prompt (T-059):
 *   - `hadFiles` (the user picked photos earlier) → always resumable;
 *   - advanced past step 1 → resumable;
 *   - any form field diverges from the pristine defaults → resumable.
 * A pristine draft sitting on step 1 with no picked files is NOT resumable, so
 * a fresh visitor never sees the prompt.
 */
export function isResumableDraft(stored: StoredWizardState | null, hadFiles: boolean): boolean {
  if (hadFiles) return true;
  if (!stored) return false;
  if (stored.reachedStep > 1) return true;
  return draftHasUserInput(stored.values);
}

export function readStoredState(): StoredWizardState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    // Field-by-field coercion below handles older payloads and schema
    // additions (e.g. `ai_matching_enabled` / `contains_minors`) gracefully
    // by falling back to defaults — no separate "schema migration" step.
    const candidateValues =
      parsed && typeof parsed === 'object' && 'values' in parsed && parsed.values
        ? (parsed.values as Record<string, unknown>)
        : (parsed as Record<string, unknown>);

    const reachedStepRaw =
      parsed && typeof parsed === 'object' && 'reachedStep' in parsed
        ? (parsed as { reachedStep: unknown }).reachedStep
        : 1;
    const returnToStepRaw =
      parsed && typeof parsed === 'object' && 'returnToStep' in parsed
        ? (parsed as { returnToStep: unknown }).returnToStep
        : null;

    // Validate event_type against the legacy is_collaborative flag — older
    // drafts predate the explicit type column.
    const eventType: 'solo' | 'collaborative' | 'organizer' =
      candidateValues.event_type === 'organizer' ||
      candidateValues.event_type === 'collaborative' ||
      candidateValues.event_type === 'solo'
        ? (candidateValues.event_type as 'solo' | 'collaborative' | 'organizer')
        : candidateValues.is_collaborative
          ? 'collaborative'
          : 'solo';

    const storedActivity = candidateValues.activity;
    const validActivity =
      typeof storedActivity === 'string' &&
      activityValues.includes(storedActivity as (typeof activityValues)[number])
        ? (storedActivity as (typeof activityValues)[number])
        : 'OTHER';

    const values: FormValues = {
      name: typeof candidateValues.name === 'string' ? candidateValues.name : '',
      activity: validActivity,
      date: typeof candidateValues.date === 'string' ? candidateValues.date : '',
      country: typeof candidateValues.country === 'string' ? candidateValues.country : '',
      state: typeof candidateValues.state === 'string' ? candidateValues.state : '',
      city: typeof candidateValues.city === 'string' ? candidateValues.city : '',
      event_type: eventType,
      is_public: typeof candidateValues.is_public === 'boolean' ? candidateValues.is_public : true,
      watermark_enabled:
        typeof candidateValues.watermark_enabled === 'boolean'
          ? candidateValues.watermark_enabled
          : true,
      is_collaborative: eventType === 'collaborative',
      allow_guest_upload:
        typeof candidateValues.allow_guest_upload === 'boolean'
          ? candidateValues.allow_guest_upload
          : true,
      require_upload_approval:
        typeof candidateValues.require_upload_approval === 'boolean'
          ? candidateValues.require_upload_approval
          : false,
      price_per_photo:
        typeof candidateValues.price_per_photo === 'number'
          ? candidateValues.price_per_photo
          : null,
      organizer_fee_per_photo:
        typeof candidateValues.organizer_fee_per_photo === 'number'
          ? candidateValues.organizer_fee_per_photo
          : null,
      ai_matching_enabled:
        typeof candidateValues.ai_matching_enabled === 'boolean'
          ? candidateValues.ai_matching_enabled
          : false,
      contains_minors:
        typeof candidateValues.contains_minors === 'boolean'
          ? candidateValues.contains_minors
          : false,
      bib_detection_enabled:
        typeof candidateValues.bib_detection_enabled === 'boolean'
          ? candidateValues.bib_detection_enabled
          : false,
    };

    const reachedStep: StepNumber =
      reachedStepRaw === 1 ||
      reachedStepRaw === 2 ||
      reachedStepRaw === 3 ||
      reachedStepRaw === 4 ||
      reachedStepRaw === 5
        ? reachedStepRaw
        : 1;
    const returnToStep: StepNumber | null =
      returnToStepRaw === 1 ||
      returnToStepRaw === 2 ||
      returnToStepRaw === 3 ||
      returnToStepRaw === 4 ||
      returnToStepRaw === 5
        ? returnToStepRaw
        : null;

    return { values, reachedStep, returnToStep };
  } catch {
    // Malformed JSON or unexpected shape — discard the draft silently and
    // start fresh. Better UX than crashing the wizard on a stale entry.
    return null;
  }
}
