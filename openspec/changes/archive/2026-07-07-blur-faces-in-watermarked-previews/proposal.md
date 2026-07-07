## Why

The watermark deters casual reuse, but an athlete's face is still fully visible in every paid-event preview — and an AI watermark remover can strip the tile and leave a usable, identifiable photo. Blurring every detected face in the preview removes the photo's value before purchase (the athlete isn't identifiable), which is the strongest anti-theft lever and matches what established sports-photo marketplaces (e.g. SurfCloud) do.

## What Changes

- Blur **all** detected faces (not just one) in the watermarked preview, with the watermark tile composited on top. **BREAKING** (behavioral): replaces the current single-face watermark "badge" — a full-face blur of every face supersedes it.
- Reuse the face bounding boxes already persisted in `photo_faces.bounding_box` — **no extra AWS calls**.
- Guarantee the blur reaches the **stored WebP thumbnails** (the gallery grid), which are baked once and cached immutably: introduce a `photo.processed` Inngest event emitted by `index-photo-faces` after indexing settles, and re-trigger `generate-photo-thumbnails` from it (instead of `photo.uploaded`) so the single immutable bake already has faces available to blur.
- Preserve the critical constraints: the **original** in storage and the **face-indexing/search** path are never blurred; only the derived preview/thumbnail buffers are.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `watermark-preview-protection`: the face-anchored single-badge overlay becomes a **blur of every detected face**; add a requirement that stored thumbnails are baked **after** indexing so their immutable copy is blurred; add a requirement that originals and the indexing/search path are never blurred.

## Impact

- **Code:** `src/lib/watermark.ts` (`addWatermarkToImage` gains all-face blur; badge helpers replaced by blur-rect helpers), `src/lib/inngest/functions/index-photo-faces.ts` (emit `photo.processed`), `src/lib/inngest/functions/generate-photo-thumbnails.ts` (trigger on `photo.processed`, fetch + pass face boxes), `src/lib/inngest/events.ts` (new event type), `src/app/api/watermark/[...path]/route.ts` (unchanged call site — gains blur automatically).
- **Pipeline:** thumbnail generation is chained after face processing; added latency is bounded and covered by the on-the-fly `/api/watermark` fallback during the pending window.
- **No** DB migration (boxes already persisted), **no** new AWS calls, **no** new visible strings, **no** change to the T-067 watermark pattern, face search, or purchased-photo delivery.
