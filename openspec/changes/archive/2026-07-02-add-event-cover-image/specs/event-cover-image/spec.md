## ADDED Requirements

### Requirement: Dedicated event cover image
An event SHALL support one optional dedicated cover image, stored as `events.cover_path` (a path in the private `photos` bucket), separate from the event's for-sale photos. The cover image is chosen by the event owner and is not part of the sale catalog.

#### Scenario: Cover uploaded during event creation
- **WHEN** a photographer creates an event and provides a cover image
- **THEN** the image is validated via `validatePhotoUpload` (magic bytes, ≤ 50 MB), stored at `${ownerId}/${eventId}/cover-<uuid>.<ext>` in the `photos` bucket, and `events.cover_path` is set to that path

#### Scenario: No cover provided
- **WHEN** an event is created without a cover image
- **THEN** `events.cover_path` is null and no cover object is written

### Requirement: Cover ownership and validation
Only the event owner SHALL be able to set, replace, or remove an event's cover, and every uploaded cover MUST pass `validatePhotoUpload`.

#### Scenario: Non-owner attempts to set a cover
- **WHEN** a user who does not own the event calls the cover upload action
- **THEN** the action rejects the request and `events.cover_path` is unchanged

#### Scenario: Replacing an existing cover
- **WHEN** the owner uploads a new cover for an event that already has one
- **THEN** the previous cover object is deleted from storage and `events.cover_path` points to the new object

#### Scenario: Invalid file rejected
- **WHEN** the owner uploads a file that fails magic-byte validation or exceeds 50 MB
- **THEN** the upload is rejected and `events.cover_path` is unchanged

### Requirement: Cover drives the event card image with fallback
Event cards across the app SHALL use `events.cover_path` (served as a short-lived signed URL, un-watermarked) as the cover image when set, and SHALL fall back to the event's first photo when `cover_path` is null.

#### Scenario: Cover set
- **WHEN** a cover-URL builder renders an event whose `cover_path` is set
- **THEN** the card cover is a signed URL for `cover_path`

#### Scenario: Cover unset (fallback preserved)
- **WHEN** a cover-URL builder renders an event whose `cover_path` is null
- **THEN** the card cover is the first photo of the event, exactly as before this change

### Requirement: Cover object is protected from the orphan sweep
The orphan-cleanup cron SHALL NOT delete cover objects even though they have no `photos` row.

#### Scenario: Cron runs while a cover exists
- **WHEN** the orphan-cleanup cron sweeps the `photos` bucket and an object is referenced by some `events.cover_path`
- **THEN** that object is treated as in-use and is not deleted

### Requirement: Cover is cleaned up on event deletion
Deleting an event SHALL remove its cover object from storage.

#### Scenario: Event with a cover is deleted
- **WHEN** an event that has a `cover_path` is soft-deleted
- **THEN** the cover object is removed from the `photos` bucket

### Requirement: Cover upload failure does not discard the event
A failure while uploading the cover during event creation SHALL NOT cause the just-created event to be discarded (the T-054 orphan-discard path).

#### Scenario: Cover upload fails after event is created
- **WHEN** the event is created successfully but the subsequent cover upload fails
- **THEN** the event is kept (with `cover_path` null), and the user is shown a non-blocking error notification (toast)
