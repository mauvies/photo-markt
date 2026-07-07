## Context

Paid-event photos are served as **watermarked previews** through two surfaces, both of which call `addWatermarkToImage(buffer, faceBoxes)` in `src/lib/watermark.ts`:

1. **On-the-fly full preview** — `src/app/api/watermark/[...path]/route.ts`. Loads face boxes via `getPhotoFaceBoxesByStoragePath` and already passes them (today used only to composite a single-face watermark "badge"). Cached 24h.
2. **Stored WebP thumbnails** (the gallery grid) — baked **once** at upload in `src/lib/inngest/functions/generate-photo-thumbnails.ts`, which for paid events calls `addWatermarkToImage(originalBuffer)` **without** face boxes today. Served by `src/app/api/thumb/[...path]/route.ts` with `Cache-Control: immutable, s-maxage=1yr` at a content-addressed path.

Face bounding boxes are already persisted in `photo_faces.bounding_box` (normalized `Left/Top/Width/Height`, 0–1) by `index-photo-faces.ts`. Today `index-photo-faces` and `generate-photo-thumbnails` **both** trigger on `photo.uploaded` and run concurrently, so at thumbnail-bake time faces are usually not yet indexed.

Hard constraints:
- The **original** in storage must never be blurred — buyers receive it via signed URLs and it never passes through `addWatermarkToImage`.
- Faces must stay **sharp for Rekognition** indexing/search (blur happens only on the derived preview, after indexing).

## Goals / Non-Goals

**Goals:**
- Blur every detected face in both watermarked preview surfaces, strongly enough to make the athlete unidentifiable, with the watermark composited on top.
- Reuse persisted bounding boxes — zero extra AWS calls.
- Guarantee the stored thumbnail's single immutable bake is already blurred (correct even under the 1-year CDN cache).
- No new DB migration, no new visible strings, no change to the T-067 pattern, face search, or purchased-photo delivery.

**Non-Goals:**
- Blurring events that don't index faces (`containsMinors` / AI disabled) — no boxes exist; those keep tile-only watermark.
- Re-baking / cache-busting already-generated thumbnails at a new URL.
- Changing indexing, search, or which photos are watermarked.

## Decisions

### Decision 1: Blur all faces inside `addWatermarkToImage`, replacing the single-face badge

Both surfaces already funnel through `addWatermarkToImage`, so putting the blur there covers both with one change. For each usable face box: map the normalized box to the resized-preview pixel dims (same geometry as the current badge), expand by a small margin so edges aren't sharp, extract that region, apply a strong Gaussian blur (and/or pixelate), and composite it back before the watermark tile. The existing single-face "badge" (`selectFaceBadgeRect` / `buildFaceBadgeComposites`) is **removed** — a full blur of every face is strictly stronger protection and makes the badge redundant.

- *Alternative considered:* keep the badge AND blur. Rejected — two overlapping marks on one face is messy and the badge adds nothing once the face is blurred.
- *Alternative considered:* pixelation only. Gaussian at strong sigma is simpler with Sharp and equally unidentifiable; a small margin prevents a sharp edge ring. Pixelation can be layered later if needed.

### Decision 2: Chain thumbnails after indexing via a new `photo.processed` event

The thumbnail's immutable, content-addressed cache means re-baking at the same path will **not** refresh the CDN — so the blur must be present on the **first** bake. That requires faces to be indexed before thumbnails generate. `index-photo-faces` emits a new `photo.processed` event at every terminal **non-rejected** outcome (indexed-with-faces, `no_faces`, `no-ai`) and in its `onFailure` handler; `generate-photo-thumbnails` triggers on `photo.processed` instead of `photo.uploaded` and fetches the persisted boxes to pass into `addWatermarkToImage`.

- *Alternative considered:* keep concurrent triggering and regenerate thumbnails after indexing. Rejected — the immutable CDN cache serves the first (unblurred) copy for up to a year; a fresh URL would mean versioning the thumb path across every read site.
- *Alternative considered:* serve the on-the-fly `/api/watermark` route for the grid instead of stored thumbnails. Rejected — loses the egress/WebP/CDN benefits of stored thumbnails.

### Decision 3: `onFailure` still emits `photo.processed`

If indexing hard-fails after retries, the photo must still get a thumbnail (unblurred — we have no boxes). Emitting `photo.processed` from `index-photo-faces.onFailure` preserves today's guarantee that a valid photo always gets a thumbnail, independent of indexing success.

### Decision 4: The on-the-fly route covers the pending window

Between upload and the thumbnail existing, `/api/thumb` 404s and the gallery falls back to `/api/watermark`, which loads current face boxes and now blurs — so the grid is never showing an unblurred indexed face, even transiently.

## Risks / Trade-offs

- **[Coupling + latency: thumbnails now wait for indexing]** → For non-AI events `index-photo-faces` still reaches a terminal state quickly (validate → promote), so the added wait is small; the on-the-fly fallback covers the gap. Independent retries are preserved (the thumbnail function keeps its own retries/onFailure).
- **[A thumbnail baked before faces exist would be permanently unblurred (immutable cache)]** → Decision 2 makes the bake happen after indexing, so for the primary flow (AI enabled at event creation → upload → index → single blurred bake) this can't occur. **Known gap:** when AI is enabled *after* photos were already uploaded (backfill / re-index), the thumbnail was first baked tile-only and the re-baked blurred copy is written to the **same** immutable `/api/thumb` URL, which the CDN/browser keeps serving stale for up to a year (`invalidateEventPhotoCache` only busts the Next.js page tags, not the image asset). The on-the-fly `/api/watermark` fallback is only used when a thumbnail is *missing*, not when it is stale, so it does not cover this. Fixing it needs thumbnail URL versioning / cache-busting across the egress-optimized thumb path — tracked as a follow-up (T-078), out of scope here. New uploads to AI-enabled events and the on-the-fly preview are always blurred.
- **[Blur must never touch the original]** → `addWatermarkToImage` only ever operates on a derived, resized buffer and returns a new buffer; the original storage object is never written. The purchased-photo path signs the original directly and never calls `addWatermarkToImage`. Covered by a regression test.
- **[Wrong coordinate mapping puts blur off the face]** → Boxes are normalized and mapped to the resized dims (`info.width/height`), identical to the existing badge geometry; a unit test asserts the mapped rect for a known box.
- **[Blur cost per preview]** → One extra Sharp extract+blur+composite per face on an already-in-memory buffer; negligible vs. the download/resize already done, and thumbnails are baked once.

## Migration Plan

No data migration. Deploy is code-only. Existing thumbnails baked before this change keep their unblurred copy until re-uploaded/re-indexed (acceptable; forward-looking protection). Rollback = revert the commit; the `photo.processed` event simply stops being consumed (Inngest ignores unhandled events).
