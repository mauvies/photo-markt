/**
 * Shared config for the two per-event backfill workers
 * (`backfill-event-indexing`, `backfill-event-bib-detection`).
 *
 * `BACKFILL_DEBOUNCE_PERIOD` is the quiet window a backfill trigger waits out
 * before running. Rapid duplicate triggers for the same event (double-click /
 * double-submit) reschedule within this window and collapse into a single run
 * (T-089). Kept short so a deliberate re-index feels responsive — a backfill
 * itself then takes minutes, so this delay is negligible.
 */
export const BACKFILL_DEBOUNCE_PERIOD = '5s';
