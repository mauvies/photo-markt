## 1. Blur in the watermark pipeline (`src/lib/watermark.ts`)

- [x] 1.1 Add a pure `computeFaceBlurRects(faceBoxes, width, height)` helper that maps every usable normalized box to resized-preview pixels, expands by a small margin, clamps to bounds, and drops degenerate/oversized boxes. Export it for unit tests.
- [x] 1.2 In `addWatermarkToImage`, blur each rect on the resized preview buffer (Sharp `extract` → strong `blur` → composite back) before the watermark tile, so the tile stays on top.
- [x] 1.3 Remove the superseded single-face badge path (`selectFaceBadgeRect` / `buildFaceBadgeComposites`), keeping tile + noise + new blur. Ensure no-faces / empty input yields tile-only with no error.
- [x] 1.4 Update the module doc comment to describe the face-blur step.

## 2. Chain thumbnails after indexing

- [x] 2.1 Add a `photo.processed` event to `src/lib/inngest/events.ts` (payload `{ photoId, eventId, storagePath }`) with a doc comment.
- [x] 2.2 In `index-photo-faces.ts`, emit `photo.processed` at every terminal non-rejected outcome (indexed, no_faces, no-ai) and in `onFailure`; do NOT emit for rejected photos.
- [x] 2.3 In `generate-photo-thumbnails.ts`, change the trigger from `photo.uploaded` to `photo.processed`; fetch the persisted face boxes (service-role) and pass them into `addWatermarkToImage` for paid events. Keep `safeCall` around Sharp/Storage.

## 3. Tests (fail before, pass after)

- [x] 3.1 Unit: `computeFaceBlurRects` — normalized→resized mapping for a known box, margin applied, multiple faces returned, degenerate/empty → none.
- [x] 3.2 Unit: `addWatermarkToImage` — with faces, the face region's local variance/high-frequency detail drops vs. the same region with no faces (proves blur); no-faces path returns a valid JPEG unchanged in that region; original buffer is not mutated.
- [x] 3.3 Integration: `index-photo-faces` emits `photo.processed` on non-rejected outcomes and not on rejected (assert via the injected `inngest.send` / step fake).
- [x] 3.4 Integration: `generate-photo-thumbnails` fetches boxes and produces a blurred thumbnail when faces exist, tile-only when none.

## 4. Verify

- [x] 4.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 4.2 Render a sample preview with a synthetic face box and visually confirm the face is blurred and the watermark composites on top.
