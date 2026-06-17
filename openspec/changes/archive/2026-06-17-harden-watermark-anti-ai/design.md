## Context

Public previews are produced on demand by `app/api/watermark/[...path]/route.ts`,
which downloads the original from Supabase Storage and runs it through
`addWatermarkToImage` in `lib/watermark.ts`. Current pipeline: resize to 1200 px →
composite a tiled PNG watermark (opacity 0.4, baked into
`public/watermark/watermark-tile.png` from `lib/watermark-tile.ts`) → 3% grain →
JPEG q70. Originals are payment-gated behind signed URLs; the route is
fail-closed (serves a placeholder, never the original, on any error).

Competitor research (Sportograf, FinisherPix, MarathonFoto, GotPhoto, PhotoBiz):
no one defeats AI removal — they degrade resolution so the cleaned copy is
useless, use thick watermarks, and place marks over subjects. FinisherPix's known
failure: over-watermarking so buyers can't evaluate, hurting conversion.

The Rekognition flow already stores per-face boxes in `photo_faces.bounding_box`
(normalized 0–1, from AWS `IndexFaces`). No new AWS calls are needed to place a
mark over a face.

## Goals / Non-Goals

**Goals:**
- Make an AI-cleaned preview unusable for print/large display (resolution).
- Make the watermark itself harder to remove cleanly (opacity + stroke).
- Place an opaque mark over one face when face data exists (most AI-resistant).
- Never break preview generation or hurt buyer evaluation.

**Non-Goals:**
- Invisible/steganographic/adversarial watermarks (broken by a screenshot+rescale).
- Any change to the purchase/originals path.
- Blocking screenshots or right-click (futile).
- New AWS calls or schema changes.

## Decisions

**1. Resolution cap 1200 → 1024 px.** Matches Sportograf's "social media res."
One-line change to the resize in `addWatermarkToImage`. Alternative (700 px) was
rejected: too aggressive, hurts evaluation; 1024 is the industry-proven floor.

**2. Tile opacity 0.4 → 0.5 + outer glyph stroke.** Config + ~3 SVG lines in
`buildWatermarkTileSvg` (add `stroke`/`stroke-width` to the glyph `<text>`),
then regenerate the committed PNG via `pnpm watermark:gen`. Thin edges are what
AI removers exploit; a stroke thickens them.

**3. Resolve face boxes by storage path.** The route only has the storage path
(`photos/userId/eventId/filename`), not a `photo_id`. Add one query in
`database/queries/photos.ts` (or `rekognition.ts`) that, given a storage path,
returns the photo's face boxes — a single join `photos → photo_faces` filtered by
the stored file path, returning at most the boxes needed. The route passes the
resulting boxes (or none) into `addWatermarkToImage` as an optional argument.
Alternative (parse IDs from the path to hit `photo_faces` directly) rejected: the
path→photo mapping is the DB's job, and the photos table is the source of truth
for the storage key.

**4. Overlay one face, conservatively.** Pick the largest / highest-confidence
box, scale normalized coords by the resized dimensions, composite one opaque
badge sized to a fraction of the box (cover, not obliterate). Keep the existing
tile underneath. Coverage/opacity are constants with `ponytail:` notes so they're
tunable without re-architecting.

**5. Face data is best-effort.** `addWatermarkToImage` takes optional face boxes;
the route wraps the lookup so any failure (no rows, `no_faces`, query error)
degrades to tile-only. Preview generation must never depend on face data.

## Risks / Trade-offs

- **Over-degradation kills conversion (FinisherPix lesson)** → 1024 px + single
  conservative face badge, not full-face blackout; values are tunable constants.
- **Extra DB query per preview** → previews are CDN-cached (`s-maxage=86400`), so
  the query runs once per photo per day, not per view. Acceptable.
- **Stale boxes vs. re-indexed photos** → boxes only move the badge; a wrong box
  still yields a valid tile-watermarked preview. Low impact.
- **AI still removes the tile on no-face photos** → resolution cap is the
  backstop for those; accepted, matches the whole industry.

## Migration Plan

- Pure forward change; no data migration. Deploy code, run `pnpm watermark:gen`,
  commit the regenerated tile PNG.
- Previews are regenerated on next request; existing CDN-cached previews expire
  within 24h or can be busted by a deploy.
- Rollback: revert the commit; previous tile PNG and 1200 px cap return on next
  cache miss.

## Open Questions

- Final numbers: face-badge opacity and coverage fraction — start at full opacity
  / ~40% of the box, tune against real event photos before merge.
