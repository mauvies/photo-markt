# Design: BIB number recognition

## Context

Photo Markt already runs an AWS Rekognition + Inngest pipeline for face matching:
- `photo.uploaded` Inngest event fans out to `indexPhotoFaces` (Rekognition `IndexFaces`) and `generatePhotoThumbnails`, in parallel.
- Per-event AI gating lives on `events` (`ai_matching_enabled`, `ai_matching_status` ∈ idle/indexing/ready/failed, `contains_minors`, `rekognition_region`, `rekognition_collection_id`), added in migration `20260518000003`.
- `photo_faces` (migration `20260518000002`) stores one row per detected face; per-photo progress is `photos.face_index_status`.
- AWS client: `src/lib/aws/rekognition-client.ts` (`getRekognitionClient`, lazy singleton). Image prep: `src/lib/aws/image-prep.ts`. Byte-safety: `src/lib/safe-call.ts` (`safeCall`) — buffers never enter Inngest step output (the function has a documented "mega-step" pattern for exactly this reason).
- Local DB grants are restored in `supabase/seed.sql` (`grant ... on all tables in schema public`); new `SECURITY DEFINER` functions must `revoke execute ... from anon, authenticated`.

Bib recognition is the same shape as face matching (per-event opt-in → background Rekognition call → per-photo rows → talent search), so it should reuse these patterns rather than invent new ones. Owner decisions: engine = Rekognition `DetectText`; cost model = per-event opt-in.

## Goals / Non-Goals

**Goals:**
- Detect race bib numbers on opted-in events' photos with controllable cost.
- Let talent filter an event gallery by bib number.
- Reuse the existing Rekognition/Inngest/safeCall conventions; add no new env vars.
- Keep false positives (sponsor text, signage) out of the bib store.

**Non-Goals:**
- Manual/editable bibs, bib-based auto-tagging to talent accounts, cross-event bib search, notifications.
- A separate AWS collection (DetectText is stateless — no collection needed, unlike faces).
- Re-architecting face indexing.

## Decisions

### D1: Engine — Rekognition `DetectText` (decided)
Reuse `getRekognitionClient()` and add `src/lib/aws/bib-detection.ts` calling `DetectText`. It returns `TextDetections[]` with `Type` (`LINE`/`WORD`), `DetectedText`, `Confidence`, and `Geometry.BoundingBox`. We key off `WORD` detections.
- *Why over Textract:* already integrated, far cheaper, and bibs are short alphanumeric tokens that don't need document OCR. Only new IAM is `rekognition:DetectText`.
- *Trade-off:* `DetectText` caps at ~100 words/image and ~10 MB; we already downscale via `prepareImageForRekognition`, which keeps us under the limit.

### D2: Cost model — per-event opt-in (decided)
New `events.bib_detection_enabled boolean not null default false`. The `detect-photo-bibs` job no-ops unless the photo's event has it true. Enabling on a populated event triggers a backfill fan-out (mirror `backfillEventIndexing`); disabling stops future detection (existing rows may be left or cleared — see Open Questions).
- *Why:* `DetectText` is paid-per-image; opt-in makes the cost intentional and bounded, exactly like `ai_matching_enabled` gates `IndexFaces`.

### D3: Separate Inngest function, same trigger
Add `detectPhotoBibs` registered at `/api/inngest`, subscribed to `photo.uploaded` (alongside `indexPhotoFaces` and `generatePhotoThumbnails`) rather than bolting onto `indexPhotoFaces`.
- *Why over extending the face job:* independent enable flag, independent failure/retry, independent status; avoids coupling two paid AWS calls into one step. Matches the existing parallel-job pattern.
- Follows the same byte-safety rule: download + `DetectText` happen inside one step; only `{ outcome, bibs? }` (small JSON) crosses step boundaries. Wrap AWS/Storage/Sharp in `safeCall`.

### D4: Data model
- `events`: add `bib_detection_enabled boolean not null default false`, `bib_detection_status text not null default 'idle'` (check in idle/detecting/ready/failed, mirroring `ai_matching_status`).
- `photos`: add `bib_detection_status text` (pending/detecting/detected/no_bibs/failed/not_applicable), mirroring `face_index_status`.
- New table `photo_bib_numbers`: `id, photo_id (fk → photos, on delete cascade), bib_text text, confidence numeric, bounding_box jsonb, detected_at timestamptz default now()`, `unique (photo_id, bib_text)`. RLS enabled; **service-role writes only**; reads for the search path via the user-scoped client gated by the same visibility rules photos already use (or via an admin-backed search action — see D6). Grants added to `supabase/seed.sql`.
- Index `photo_bib_numbers (bib_text)` (and consider `(bib_text)` + a join to event) for search.

### D5: Filtering pipeline (false-positive control)
A pure, unit-tested helper `extractBibCandidates(detections, opts)`:
1. Keep `WORD` detections with `Confidence ≥ BIB_CONFIDENCE_THRESHOLD` (default ~80, config in `src/lib/feature-flags.ts` or a bib config module).
2. Normalize (trim, strip stray punctuation); keep tokens matching a configurable bib pattern — digit-dominant, length 1–5 (e.g. `^\d{1,5}[A-Z]?$`). Reject pure-alpha tokens (sponsor/sign text).
3. Dedupe identical normalized tokens per photo; cap per photo (e.g. top-N by confidence) to bound rows.
- *Why pure:* the filtering rules are the part most likely to need tuning and are cheaply testable without AWS/DB (the regression-test seam).

### D6: Search
- Query: `src/database/queries/bib-numbers.ts` → `getPhotoIdsByBibInEvent(eventId, bib)` joining `photo_bib_numbers → photos` filtered to the event and to visible/approved/non-minor photos (reuse the same filters `searchFacesByImage`'s result mapping applies).
- Action: an event-gallery server action mirroring `searchFacesInEvent` — validates input (trim, pattern), runs the query, returns matched photo IDs; the gallery component buckets/filters to those photos. Rate-limit per `(event, IP)` like face search.
- UI: a bib-search input on the event detail gallery surface, shown only when `bib_detection_enabled`. New i18n strings (en + es).

### D7: Plan gating
Available on all three plans (matches advertised copy). The opt-in is the cost gate, not the plan. Remove the "Coming soon" badge from `freeFeature4`/`starterFeature4`/`proFeature4` in `src/lib/plan-features.ts` as the final shipping task.

## Risks / Trade-offs

- **False positives (sponsor/sign numbers, partial bibs)** → D5 filter (confidence + digit-dominant pattern + per-photo cap); thresholds are config so they can be tuned post-launch. Document that detection is best-effort.
- **AWS cost on large opted-in events** → opt-in is per-event; detection runs once per photo (not per search). Consider a soft per-event ceiling later if needed (out of scope).
- **OCR misses angled/occluded/blurred bibs** → accepted; bib search complements (not replaces) face search and browsing.
- **`DetectText` word cap on crowded photos** → downscale already applied; we keep only digit-dominant tokens so the cap rarely bites for bibs.
- **Privacy** → bib numbers are low-sensitivity race identifiers, not PII; the selfie/face flow is unaffected. Respect `contains_minors` parity (no broader exposure than face search). Document in privacy copy.
- **Status drift** like the early Rekognition fan-out → reuse the same "mark event ready when in-flight count hits zero" pattern; guard with the per-photo terminal status.

## Migration Plan

1. Ship migration (events columns + photos column + `photo_bib_numbers` + indexes) and the `seed.sql` grants; no backfill at deploy (flag defaults false → no cost, no behavior change).
2. Land the AWS lib + Inngest function + queries + action behind the per-event flag (flag still defaults off → safe to deploy incrementally).
3. Add the photographer opt-in UI and the talent bib-search UI.
4. Only after the path is verified end-to-end, remove the "Coming soon" badges.
- **Rollback:** set `bib_detection_enabled` false everywhere (stops cost/behavior); the migration is additive and safe to leave in place. Re-add badges if reverting the feature surface.

## Open Questions

- **Disable semantics:** when an owner turns detection off, do we keep existing `photo_bib_numbers` (cheap, lets re-enable be instant) or clear them? Proposed default: keep, and just stop search/detection. Confirm at apply time.
- **Backfill scope/limits:** cap concurrency/most-recent-N on very large events to bound a sudden cost spike? Mirror whatever `backfillEventIndexing` does.
- **Plan parity vs. cost:** the copy advertises bib recognition on all plans; if AWS cost becomes material, do we later restrict opt-in (or volume) by plan? Out of scope now; flagged for product.
- **Search input scope:** exact-match only (v1) vs. prefix/range. Proposed v1: exact normalized match.
