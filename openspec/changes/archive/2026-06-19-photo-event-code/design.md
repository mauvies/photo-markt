## Context

`photos` rows are inserted in a batched loop in `attachPhotosToEvent` via `createPhoto` (owner) and `uploadGuestPhoto` (guest collaborative, admin client). The photographer event album (`event-photo-album.tsx`) renders photos through `PhotoGallery` → `PhotoAlbumViewer`; tiles carry the `PhotoAlbumItem` shape. There is no per-photo ordering or editable identifier today.

## Goals / Non-Goals

**Goals:**
- A stable, auto-assigned per-event code for every photo, set at insert for both owner and guest uploads.
- An optional photographer-editable text override, falling back to the auto code when empty.
- Display + edit in the photographer album only.

**Non-Goals:**
- No exposure to talent/buyers/public views.
- No reordering UI, no uniqueness enforcement on the label, no renumbering on delete (gaps allowed).
- No change to upload throughput or the Inngest indexing flow.

## Decisions

- **Two columns, not one.** `sequence int` (stable auto code) + `label text` (nullable override). Display = `label ?? "#" + sequence`. Keeping the auto code separate means clearing a label always restores a meaningful, stable identifier.
- **Assign the sequence with a `BEFORE INSERT` trigger** backed by a **monotonic per-event counter** (`events.photo_sequence_counter`), not in app code. The trigger does `UPDATE events SET photo_sequence_counter = photo_sequence_counter + 1 ... RETURNING ... INTO NEW.sequence`. This covers both `createPhoto` and `uploadGuestPhoto` (and any future insert path) with zero change to the batched insert loop. Two properties fall out for free: numbers are **never reused** (the counter only goes up — deleting the highest photo does not free its number, unlike a `max()+1` scheme), and concurrent inserts to the same event **cannot collide** because the `UPDATE` locks the event row. The trigger function is plain (not `SECURITY DEFINER`) — it runs as the inserting role, which already holds the needed rights.
- **Backfill** existing rows with `row_number() over (partition by event_id order by created_at, id)` so current events get sensible codes.
- **Index** `(event_id, sequence)` to keep ordered reads and the trigger's `max()` cheap.
- **Editing** mirrors `deletePhotoAction`: owner-scoped query `updatePhotoLabel(supabase, photoId, eventId, userId, label)` + Server Action `updatePhotoLabelAction` that checks event ownership (`getEvent(supabase, eventId, user.id)`), validates (trim, ≤50 chars, empty → null), and revalidates. No API route.
- **Display ordering stays by `taken_at`** (unchanged) — the code is an identifier, not the sort key, for this change.

## Risks / Trade-offs

- **Per-event lock on insert:** the counter `UPDATE` serializes concurrent inserts into the *same* event for the row's brief lock window. Inserts into *different* events are unaffected. This is the right trade for correctness (no reuse, no collisions) at this scale.
- **Backfill cost:** a one-time window function over `photos` plus a counter update per event; negligible at current size.
- **UI surface:** threading a per-tile badge + edit handler through `PhotoGallery`/`PhotoAlbumViewer` touches shared gallery code, but gated to the photographer album (other consumers pass nothing and are unaffected).
