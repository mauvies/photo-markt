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

- [ ] 3.1 `src/lib/inngest/functions/detect-photo-bibs.ts`: subscribe to `photo.uploaded`; no-op unless the event has `bib_detection_enabled`; download + `DetectText` + filter inside one step (bytes never cross step boundaries); persist via the query layer; set per-photo `bib_detection_status`; `onFailure` → `failed`.
- [ ] 3.2 Register the function at `src/app/api/inngest/route.ts` (parallel to `indexPhotoFaces` / `generatePhotoThumbnails`).
- [ ] 3.3 Backfill path: enabling on a populated event fans out detection over existing photos (mirror `backfillEventIndexing`); event `bib_detection_status` transitions idle→detecting→ready.
- [ ] 3.4 Integration test for the job flow with a fake `step` (mirror the face-job test): opted-in photo → rows persisted + status `detected`; non-opted-in → `not_applicable`, no AWS call.

## 4. Query layer + persistence

- [ ] 4.1 `src/database/queries/bib-numbers.ts`: `persistPhotoBibs(...)`, `getPhotoIdsByBibInEvent(eventId, bib)` (join to photos, filter to visible/approved/non-minor), and a per-photo status updater. Export from `queries/index.ts`.
- [ ] 4.2 Integration tests: persistence dedupe `(photo_id, bib_text)`; search returns only matching + visible photos in the event.

## 5. Photographer opt-in

- [ ] 5.1 Event create/edit + settings: a "Detect bib numbers" toggle that sets `bib_detection_enabled` (owner-only server action; reuse the AI-matching gating pattern). Enabling triggers the backfill.
- [ ] 5.2 i18n strings (en + es) for the toggle + helper copy.
- [ ] 5.3 Test the toggle action: owner can flip it; non-owner is rejected; enabling on a populated event enqueues backfill.

## 6. Talent bib search

- [ ] 6.1 Event-gallery server action `searchPhotosByBib(eventId, bib)` mirroring `searchFacesInEvent` (validate/normalize input, rate-limit per `(event, IP)`, return matched photo IDs).
- [ ] 6.2 Bib-search input on the event detail gallery, shown only when `bib_detection_enabled`; filter the gallery to matches; empty-state on no matches.
- [ ] 6.3 i18n strings (en + es) for the search input + empty state.
- [ ] 6.4 Tests for the search action (match, no-match empty, unavailable when detection off).

## 7. Ship + docs

- [ ] 7.1 Remove the "Coming soon" badge from `freeFeature4`/`starterFeature4`/`proFeature4` in `src/lib/plan-features.ts` (and any guard test that asserts the badge).
- [ ] 7.2 Update `CLAUDE.md` / `ARCHITECTURE.md`: document the bib pipeline alongside AI Photo Search; note the per-event opt-in and the privacy treatment.
- [ ] 7.3 Full gate green: `pnpm typecheck && pnpm lint && pnpm test`; `/code-review` (touches DB/migration + jobs).
