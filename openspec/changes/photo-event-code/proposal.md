## Why

Photographers upload many photos to an event and have no way to identify or order them. Other sports-photography platforms give each photo a stable code (e.g. a sequence or a bib/lane number) so the photographer can organize, reference and find a specific shot. Today `photos` has no ordering or editable identifier — only `original_filename` (display-only). Now that authenticated users land in the dashboard (T-005), the photographer's event album is the main place this matters.

## What Changes

- Every photo gets a **stable auto-assigned per-event code** (a sequence number) when uploaded — including guest collaborative uploads.
- The photographer can **override** that code with their own short text label per photo (e.g. a bib number). Clearing it falls back to the auto sequence.
- The code is shown on each tile in the **photographer's** event album and is editable from there. It is **not** exposed to talent/buyers or public views.
- No change to upload throughput or the Inngest face-indexing flow.

## Capabilities

### New Capabilities
- `photo-event-code`: a per-event photo identifier — an auto-assigned, stable sequence plus an optional photographer-editable text label — surfaced and editable only in the photographer's event album.

### Modified Capabilities
<!-- none: no existing spec's requirements change -->

## Impact

- **DB:** new migration adding `photos.sequence` (int) + `photos.label` (text, nullable); a `BEFORE INSERT` trigger assigning `max(sequence)+1` per `event_id`; backfill of existing rows per event by `created_at`; index on `(event_id, sequence)`.
- **Queries:** `database/queries/photos.ts` — select the new columns in `getEventPhotos`; new owner-scoped `updatePhotoLabel`.
- **Server Action:** `updatePhotoLabelAction` (auth + event ownership, revalidate) in the photographer event `edit/actions.ts`. No API routes.
- **UI:** `event-photo-album.tsx` + `PhotoGallery`/`PhotoAlbumViewer` — render the code badge per tile and an edit affordance; thread the new field/handler. Photographer-only; talent/public viewers unchanged.
- **i18n:** new strings in `en.json` + `es.json`.
- **Tests:** sequence auto-assignment on insert; `updatePhotoLabel` ownership (owner edits, non-owner rejected).
- The insert path (`attachPhotosToEvent` batched loop) is unchanged — the trigger handles sequence for both owner and guest inserts.
