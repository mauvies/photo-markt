## Why

A watermarked preview can be cleaned by AI inpainting tools in seconds, and the
recovered image is good enough to use when the preview is served at 1200 px. The
real defense — as used by Sportograf, FinisherPix, and MarathonFoto — is not to
out-watermark the AI but to degrade the preview so the recovered image is
worthless for printing/large posting, and to make the watermark itself harder to
remove cleanly (thicker mark, and a mark placed over faces, which inpainting
reconstructs badly). Full-resolution clean originals are already gated behind
purchase (signed URLs), so this change only hardens the public preview path.

## What Changes

- **Solution 1 — degrade + thicken the preview watermark (config tuning):**
  - Lower the preview longest-side cap from 1200 px to 1024 px (matches Sportograf's "social media res").
  - Raise watermark tile opacity from 0.4 to ~0.5 (industry minimum for AI resistance).
  - Add an outer stroke to the tile glyphs so thin text edges can't be cleanly rendered out by AI tools.
- **Solution 2 — face-anchored watermark overlay:**
  - When a photo has indexed faces (`photo_faces.bounding_box`), composite one additional opaque watermark badge over a face region, on top of the existing tile.
  - This reuses data already produced by the Rekognition indexing flow — no new AWS calls.
  - Cover **one** face zone, not all and not fully opaque, to preserve buyer evaluation (FinisherPix's mistake was over-watermarking and killing conversion).
  - Fall back cleanly to the tile-only preview when a photo has no usable face box (`no_faces` / `pending` / `failed`, or no rows).
- The watermark serving path (`/api/watermark/[...path]`) gains the ability to resolve a photo's face boxes for the requested image.

No breaking changes. Purchase/originals path untouched.

## Capabilities

### New Capabilities
- `watermark-preview-protection`: Defines how public preview images are degraded and watermarked to resist AI watermark removal — resolution cap, tile opacity/stroke, and the face-anchored overlay with its fallback behavior.

### Modified Capabilities
<!-- None — no existing spec covers the watermark pipeline. -->

## Impact

- **Code:** `lib/watermark.ts` (resize cap, face-overlay compositing, fallback), `lib/watermark-tile.ts` (opacity + glyph stroke), `app/api/watermark/[...path]/route.ts` (resolve photo_id → face boxes), `public/watermark/watermark-tile.png` (regenerated via `pnpm watermark:gen`).
- **Data:** reads `photo_faces.bounding_box` (existing) via a new query in `database/queries/`. No schema change, no new AWS calls.
- **Risk:** over-degradation hurts conversion — opacity/coverage values are tunable knobs, defaults chosen conservatively.
