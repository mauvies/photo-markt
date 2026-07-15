# Proposal: BIB number recognition

## Why

We advertise "BIB number recognition" in all three pricing plans, but it does not exist — it currently ships behind a "Coming soon" badge (T-030). Athletes overwhelmingly know their race **bib number**, so detecting it per photo and letting talent search an event by bib is the single highest-signal way to find your own photos (more reliable than free-text and complementary to face search). This closes the gap between what we sell and what we ship.

## What Changes

- Photographers can **opt a given event into bib detection** (a new per-event flag), mirroring how Rekognition AI matching is gated per event today. Detection only runs for opted-in events — this is the cost control for a paid-per-photo AWS call.
- When enabled, each uploaded photo is run through **AWS Rekognition `DetectText`** in an Inngest background job alongside face indexing, reusing the existing Rekognition client, image-prep, and `safeCall` byte-safety conventions.
- Detected bib tokens are **persisted per photo** (text + confidence + bounding box), after filtering `DetectText` output down to plausible bib numbers (digit-dominant short tokens, confidence threshold, dedupe).
- Talent can **search an event's gallery by bib number** — filtering to photos whose detected bib matches — surfaced on the same event-gallery surface as face search.
- Enabling bib detection on an **existing** event **backfills** its already-uploaded photos (fan-out), mirroring `backfillEventIndexing`.
- The feature is offered on **all three plans** (as advertised); the per-event opt-in — not the plan tier — is the cost gate. (Open question flagged in design.)
- The "Coming soon" badge is removed from `freeFeature4` / `starterFeature4` / `proFeature4` **once the feature ships** (tracked as a task, done last).

Non-goals: editable/manual bib numbers, bib-based notifications/auto-tagging to talent accounts, cross-event bib search, and bib detection for non-opted-in events.

## Capabilities

### New Capabilities
- `bib-number-recognition`: per-event opt-in detection of race bib numbers on event photos via AWS Rekognition `DetectText`, persistence of detected bibs per photo, and talent search of an event gallery by bib number.

### Modified Capabilities
<!-- None: there is no existing spec under openspec/specs/ for event AI/search to amend; this is net-new. -->

## Impact

- **Database (migration):** new `photo_bib_numbers` table (per-photo detected bibs); new `events` columns for the opt-in flag + detection status; new per-photo `bib_detection_status` column. Matching grants in `supabase/seed.sql` (local-grants convention); any `SECURITY DEFINER` function must `revoke execute ... from anon, authenticated`.
- **AWS:** new `DetectText` call (added cost per photo on opted-in events) via the existing `getRekognitionClient`. No new IAM beyond the `rekognition:DetectText` permission.
- **Background jobs (Inngest):** a new `detect-photo-bibs` function on the existing `photo.uploaded` event (parallel to `indexPhotoFaces` / `generatePhotoThumbnails`), plus a backfill path on enable.
- **Queries / actions / UI:** new `bib-numbers` query module, an event-gallery bib-search action, and bib-search UI on the event detail surface; new i18n strings (en + es).
- **Plan features:** remove "Coming soon" from `freeFeature4`/`starterFeature4`/`proFeature4` in `src/lib/plan-features.ts` (last task).
- **Env:** none new (reuses `AWS_*` / `REKOGNITION_*`).
