## ADDED Requirements

### Requirement: Preview resolution cap

The public preview pipeline SHALL resize images so the longest side is at most
1024 px, and SHALL NOT upscale images smaller than that. This degrades any
AI-cleaned copy below print/large-display usefulness while keeping the preview
viewable.

#### Scenario: Large original is capped

- **WHEN** an original photo with longest side 4000 px is requested as a preview
- **THEN** the returned preview has longest side 1024 px

#### Scenario: Small original is not upscaled

- **WHEN** an original photo with longest side 800 px is requested as a preview
- **THEN** the returned preview keeps longest side 800 px

### Requirement: Hardened watermark tile

The tiled watermark SHALL be composited at an opacity of at least 0.5 and each
glyph SHALL carry an outer stroke, so that thin text edges cannot be cleanly
removed by AI watermark-removal tools.

#### Scenario: Tile opacity floor

- **WHEN** the watermark tile is generated with default config
- **THEN** the glyph fill-opacity is at least 0.5 and a stroke is rendered around each glyph

### Requirement: Face-anchored watermark overlay

When a photo has at least one usable indexed face box, the preview pipeline SHALL
composite one additional opaque watermark badge over a single face region, on top
of the tile. The overlay SHALL cover only one face zone (not all faces) so the
buyer can still evaluate the photo.

#### Scenario: Photo with an indexed face gets a face overlay

- **WHEN** a preview is generated for a photo that has a `photo_faces` row with a bounding box
- **THEN** an opaque watermark badge is composited over that face region in addition to the tile

#### Scenario: Bounding box is mapped to resized coordinates

- **WHEN** a face bounding box stored as normalized values (0–1) is applied to a resized preview
- **THEN** the overlay is positioned using the bounding box scaled to the resized preview dimensions

### Requirement: Fallback when no face data

The preview pipeline SHALL fall back to the tile-only watermark (no face overlay)
when a photo has no usable face box — including face index status `no_faces`,
`pending`, or `failed`, or when no `photo_faces` rows exist. Preview generation
SHALL NOT fail because face data is missing.

#### Scenario: Photo without faces still gets a preview

- **WHEN** a preview is generated for a photo with `face_index_status` of `no_faces`
- **THEN** the tile-only watermarked preview is returned without error and without a face overlay

#### Scenario: Face lookup error does not break the preview

- **WHEN** the face-box lookup fails for a requested photo
- **THEN** the tile-only watermarked preview is still returned
