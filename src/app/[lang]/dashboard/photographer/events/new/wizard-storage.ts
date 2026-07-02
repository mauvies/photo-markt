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
      reachedStepRaw === 1 || reachedStepRaw === 2 || reachedStepRaw === 3 || reachedStepRaw === 4
        ? reachedStepRaw
        : 1;
    const returnToStep: StepNumber | null =
      returnToStepRaw === 1 ||
      returnToStepRaw === 2 ||
      returnToStepRaw === 3 ||
      returnToStepRaw === 4
        ? returnToStepRaw
        : null;

    return { values, reachedStep, returnToStep };
  } catch {
    // Malformed JSON or unexpected shape — discard the draft silently and
    // start fresh. Better UX than crashing the wizard on a stale entry.
    return null;
  }
}
