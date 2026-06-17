## 1. Solution 1 — degrade + thicken the tile

- [x] 1.1 Lower the resize cap in `addWatermarkToImage` (`lib/watermark.ts`) from 1200 to 1024 px (keep `withoutEnlargement`).
- [x] 1.2 In `lib/watermark-tile.ts`: bump `DEFAULT_WATERMARK_TILE_CONFIG.opacity` to ~0.5 and add an outer stroke (`stroke`/`stroke-width`/`stroke-opacity`) to the glyph `<text>` in `buildWatermarkTileSvg`.
- [x] 1.3 Regenerate the committed tile: `pnpm watermark:gen`; commit the updated `public/watermark/watermark-tile.png`.
- [x] 1.4 Update/extend the `buildWatermarkTileSvg` unit test to assert the stroke is present and opacity ≥ 0.5.

## 2. Solution 2 — face box lookup

- [x] 2.1 Add a query (`getPhotoFaceBoxesByStoragePath`) in `database/queries/rekognition.ts` — kept beside the other face queries rather than `photos.ts` for cohesion; given a storage path, returns the photo's face boxes. Exported via the existing `export *`.
- [x] 2.2 Write an integration test for the query: a photo with a face row returns its box; a photo with no faces returns empty; no matching photo returns empty.

## 3. Solution 2 — face-anchored overlay

- [x] 3.1 Added optional `faceBoxes` param to `addWatermarkToImage`; picks largest/highest-confidence box, scales normalized coords, composites a tile-based badge over the face on top of the tile.
- [x] 3.2 `FACE_BADGE_COVERAGE`/`FACE_BADGE_STACK` constants with `ponytail:` comment naming the opacity ceiling and the bake-a-dedicated-PNG upgrade path.
- [x] 3.3 Route looks up face boxes by path, wrapped so any failure logs and degrades to tile-only, then passes them in.
- [x] 3.4 Unit-tested the pure `selectFaceBadgeRect` geometry (scaling, centering, largest-face pick, degenerate→null) + an `addWatermarkToImage` smoke test (random grain makes byte-diffing the badge unreliable).

## 4. Verify

- [x] 4.1 `pnpm lint`, `pnpm typecheck` pass; watermark unit tests + rekognition integration test green.
- [ ] 4.2 Manually preview a face photo and a no-face photo; confirm overlay appears only on the former and both render (no placeholder). _(needs real event photos — left for the user)_
- [ ] 4.3 Tune face-badge opacity/coverage and tile opacity against real event photos so buyers can still evaluate (avoid the FinisherPix over-watermark failure). _(visual judgment on real photos — left for the user)_
