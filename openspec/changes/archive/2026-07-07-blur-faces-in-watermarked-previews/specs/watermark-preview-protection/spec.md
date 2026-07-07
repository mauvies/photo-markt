## MODIFIED Requirements

### Requirement: Fallback when no face data

The preview pipeline SHALL fall back to the tile-only watermark (no face blur)
when a photo has no usable face box — including face index status `no_faces`,
`pending`, or `failed`, or when no `photo_faces` rows exist. Preview generation
SHALL NOT fail because face data is missing.

#### Scenario: Photo without faces still gets a preview

- **WHEN** a preview is generated for a photo with `face_index_status` of `no_faces`
- **THEN** the tile-only watermarked preview is returned without error and without any face blur

#### Scenario: Face lookup error does not break the preview

- **WHEN** the face-box lookup fails for a requested photo
- **THEN** the tile-only watermarked preview is still returned

## ADDED Requirements

### Requirement: Blur every detected face in the preview

When a photo has one or more usable indexed face boxes, the preview pipeline SHALL
blur **every** face region strongly enough that the person is not identifiable,
then composite the watermark tile on top. Each face box (stored normalized 0–1)
SHALL be mapped to the resized-preview pixel dimensions and expanded by a small
margin so the blurred region has no sharp edge. The blur SHALL apply only to the
derived preview buffer.

#### Scenario: Single indexed face is blurred

- **WHEN** a preview is generated for a photo with one `photo_faces` bounding box
- **THEN** the returned preview has that face region blurred to non-identifiable and the watermark tile composited over the whole image

#### Scenario: All faces are blurred when several are present

- **WHEN** a preview is generated for a photo with multiple `photo_faces` bounding boxes
- **THEN** every one of those face regions is blurred in the returned preview

#### Scenario: Bounding box is mapped to resized coordinates

- **WHEN** a face bounding box stored as normalized values (0–1) is applied to a resized preview
- **THEN** the blurred region is positioned using the bounding box scaled to the resized preview dimensions, plus a small margin

### Requirement: Stored thumbnails are blurred on their first bake

The stored watermarked thumbnail's first (and only) generated copy SHALL already
contain the face blur, because thumbnails are content-addressed and cached
immutably. Thumbnail generation for a photo SHALL run only after that photo's face
indexing has settled, so the persisted face boxes are available at bake time. A
photo whose indexing reached a terminal non-rejected outcome — including when no
faces were found, when AI matching is not applicable, and when indexing failed —
SHALL still get a thumbnail (tile-only when no boxes are available).

#### Scenario: Thumbnail for an indexed photo is blurred once

- **WHEN** a paid-event photo finishes face indexing with at least one face
- **THEN** the stored thumbnail generated for it has every detected face blurred

#### Scenario: Photo with no applicable AI still gets a thumbnail

- **WHEN** a photo reaches a terminal non-rejected outcome with no usable face boxes (AI disabled, contains-minors, no faces, or indexing failed)
- **THEN** a tile-only watermarked thumbnail is still generated without error

#### Scenario: Rejected photo gets no thumbnail

- **WHEN** a photo is rejected during validation and deleted from storage
- **THEN** no thumbnail generation is triggered for it

### Requirement: Originals and face indexing are never blurred

The blur SHALL apply only to derived preview and thumbnail buffers. The original
stored photo SHALL never be modified, the full-resolution photo delivered to a
buyer SHALL never be blurred, and face indexing/search SHALL operate on the
un-blurred image so matching is unaffected.

#### Scenario: Original is untouched by preview generation

- **WHEN** a watermarked, face-blurred preview is generated for a photo
- **THEN** the original object in storage is unchanged and any later signed-URL download returns the un-blurred original

#### Scenario: Indexing runs before blur

- **WHEN** a photo is processed for face indexing and then a preview is generated
- **THEN** indexing reads the sharp original and the blur is applied only afterward to the preview
