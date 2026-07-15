# Tasks: BIB number recognition

> Phased for incremental, reviewable PRs. The per-event flag defaults OFF, so phases 1–4
> are safe to ship before any UI. Badge removal (phase 7) is intentionally last.

## 1. Database

- [x] 1.1 Migration: add `events.bib_detection_enabled boolean not null default false` and `events.bib_detection_status text not null default 'idle'` with a check constraint (`idle`/`detecting`/`ready`/`failed`), mirroring `ai_matching_status`. — `20260625000000_add_bib_detection_columns_to_events.sql`
- [x] 1.2 Migration: add `photos.bib_detection_status text` (nullable; values `pending`/`detecting`/`detected`/`no_bibs`/`failed`/`not_applicable`), mirroring `face_index_status`. — `20260625000002_add_bib_detection_status_to_photos.sql`
- [x] 1.3 Migration: create `photo_bib_numbers` (`id`, `photo_id` fk→photos on delete cascade, `bib_text`, `confidence`, `bounding_box jsonb`, `detected_at`), `unique (photo_id, bib_text)`, index on `bib_text`; RLS with a read policy (owner / public-event) and no write policies (service-role only). — `20260625000001_create_photo_bib_numbers.sql`
- [x] 1.4 Grants: the new table is covered by the existing `grant ... on all tables` + `alter default privileges` in `supabase/seed.sql` (no edit needed); verified anon/authenticated/service_role hold DML and RLS gates writes. No `SECURITY DEFINER` function added.
- [x] 1.5 `pnpm db:reset` applies the migrations + seed grants cleanly; all four schema objects confirmed.

## 2. AWS DetectText + filtering

- [x] 2.1 `src/lib/aws/bib-detection.ts`: `detectTextForPhoto` calls `DetectText` via `getRekognitionClient()`; returns `WORD` detections (text, confidence, bounding box). (`safeCall` wrapping happens at the Inngest call site in phase 3, matching the face job.)
- [x] 2.2 Pure helper `extractBibCandidates(detections, opts)` in `src/lib/bib-numbers.ts`: confidence floor + digit-dominant pattern + dedupe + per-photo cap, with exported config constants.
- [x] 2.3 Unit tests for `extractBibCandidates` (`test/unit/lib/bib-numbers.test.ts`): sponsor text discarded, low-confidence discarded, dupes collapse, cap honored, bounding box carried.

## 3. Inngest detection job

- [x] 3.1 `src/lib/inngest/functions/detect-photo-bibs.ts`: subscribes to `photo.uploaded` + `photo.bib-detect`; no-op (status stays NULL) unless the event has `bib_detection_enabled` (and not minors); download + `DetectText` + filter in one step (bytes never cross boundaries); persist; set per-photo `bib_detection_status`; `onFailure` → `failed`; `maybe-mark-event-ready`.
- [x] 3.2 Registered both `detectPhotoBibs` and `backfillEventBibDetection` at `src/app/api/inngest/route.ts`.
- [x] 3.3 Backfill: `backfill-event-bib-detection.ts` on `event.bib-detection-enabled` lists photos needing detection, resets to `pending`, fans out `photo.bib-detect` (bib-specific event → never re-runs face/thumbnail jobs); event status idle→detecting→ready.
- [x] 3.4 `test/integration/inngest/detect-photo-bibs.test.ts` (pass-through step, AWS mocked, real Sharp prep): opted-in → rows persisted (sponsor text filtered) + status `detected`; nothing-passes → `no_bibs`; non-opted-in → skipped, no AWS call, status NULL.

## 4. Query layer + persistence

- [x] 4.1 `src/database/queries/bib-numbers.ts`: event state read/update, `persistPhotoBibs` (idempotent upsert), per-photo + bulk status, in-flight count, backfill list, and `getPhotoIdsByBibInEvent(eventId, bib)` (event-scoped exact match). Exported from `queries/index.ts`.
- [x] 4.2 `test/integration/queries/bib-numbers.test.ts`: state round-trip, persistence dedupe `(photo_id, bib_text)`, event-scoped exact search, in-flight count.

## 5. Photographer opt-in

- [x] 5.1 `enableBibDetectionForEvent` / `disableBibDetectionForEvent` (owner-only, mirroring the AI actions; enable fires `event.bib-detection-enabled` for backfill, disable keeps existing rows) + a `BibDetectionToggle` card on the photographer event detail page (owner-only, disabled for minors events).
- [x] 5.2 i18n `bibDetection` block in en + es (toggle title/description/states + the search strings used in phase 6).
- [x] 5.3 `test/integration/actions/bib-detection-toggle.test.ts`: owner enables (flag + backfill enqueue), owner disables, non-owner rejected (no enqueue), minors event rejected.

## 6. Talent bib search

- [x] 6.1 `searchPhotosByBibInEvent(shareCode, bib)` in `events/[shareCode]/actions.ts` (mirrors `searchFacesInEvent`): resolve event, require detection enabled, rate-limit `(shareCode, IP)` 30/h, normalize input, return matched PUBLIC photo ids (cross-referenced against `getEventPhotosPublic`).
- [x] 6.2 `BibSearchBar` on the **public** event gallery (`/events/[shareCode]`), gated on `bib_detection_enabled`; a bib-search context in `EventGalleryWithFaceSearch` filters the grid to matches with a bib-specific empty state. (Talent-dashboard event view not surfaced yet — documented follow-up.)
- [x] 6.3 i18n strings (en + es) — included in the `bibDetection` block (search title/placeholder/button/clear/empty/failed).
- [x] 6.4 `test/integration/actions/bib-search.test.ts`: match, normalized query, no-match empty, throws when detection off.

## 7. Ship + docs

- [x] 7.1 Removed the "Coming soon" badge from `freeFeature4`/`starterFeature4`/`proFeature4` in `src/lib/plan-features.ts`; updated the guard test `plan-features.test.ts` (BIB now un-badged; outfit-pattern/search-priority stay).
- [x] 7.2 Documented the bib pipeline in `CLAUDE.md` (new "BIB number recognition" section): opt-in, job, persistence, search, privacy, cost.
- [x] 7.3 Full gate (`typecheck`/`lint`/`test`/`build`) + `/code-review` on the diff.
