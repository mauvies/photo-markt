## Context

Event cards render `coverUrl`/`coverThumbUrl` (`src/components/event-card.tsx`), but the value is auto-derived: each of ~6 builders picks the first photo of the event as the cover. Photos live in the private `photos` Supabase Storage bucket and are served to cards via short-lived signed URLs. There is no cover column on `events`.

Two storage-lifecycle mechanisms constrain the design:
- The Inngest cron `cleanup-orphaned-storage.ts` sweeps `photos`-bucket objects with no matching `photos.original_url` row (1h age) — a cover object would be swept unless protected.
- Event deletion (`deleteEventAction` + `cleanup-on-event-delete.ts`) removes storage only for `photos` rows — a cover object would be left behind.

The user chose a **dedicated uploaded cover image** (not a pick from the sale photos).

## Goals / Non-Goals

**Goals:**
- Let the owner attach one dedicated cover image when creating an event.
- Use it as the card cover everywhere, with a null-safe fallback to the first photo (no regression).
- Keep the storage lifecycle correct: never swept by the cron, always cleaned on delete.
- Reuse existing primitives (`validatePhotoUpload`, `photos` bucket, signed URLs).

**Non-Goals:**
- Changing/removing the cover from the event edit/detail page after creation (follow-up ticket).
- A separate `covers` bucket, watermarking the cover, or CDN/public-URL serving.
- Picking one of the event's sale photos as the cover.

## Decisions

- **Store as `events.cover_path` in the existing `photos` bucket** under `${ownerId}/${eventId}/cover-<uuid>.<ext>`.
  - *Why:* reuses the private bucket, its signed-URL serving, and `validatePhotoUpload`. Alternative — a dedicated `covers` bucket — was rejected to avoid provisioning/RLS surface for one image type (and the T-053 lesson that every bucket must be migration-provisioned). Keeping it in `photos` means the cron/deletion must be made cover-aware (below), which is a small, contained cost.
- **One nullable column `events.cover_path text`.** Null ⇒ current first-photo fallback, so existing events are unaffected and rollback is trivial (ignore the column).
- **Dedicated server action for the cover upload**, owner-checked, `validatePhotoUpload` first, deletes the previous cover on replace, sets `cover_path`. It receives the file as `FormData` (like other single-file server-action uploads) rather than the signed-URL PUT dance used for bulk photo uploads — the cover is a single small image, so a direct server upload (`uploadFile`) is simpler and avoids minting/attaching.
- **Wizard wiring:** hold the chosen cover `File` in wizard state; after `createEvent` returns the `eventId`, call the cover upload action. Cover-upload failure is caught and surfaced as a toast, and explicitly does **not** mark the flow as a hard-stop — so the T-054 orphan-discard never fires for a cover-only failure. The event is kept with `cover_path` null.
- **Cover resolution in builders:** each builder already loads its event rows; add `cover_path` to those selects and prefer a signed URL for `cover_path` when set, else the existing first-photo path. Centralize the "resolve signed cover for a set of events" in one small query helper so the 6 call sites stay consistent.
- **Cron safety:** in `cleanup-orphaned-storage.ts`, extend the "in-use" set to also include `events.cover_path` values (one extra `select cover_path from events where cover_path in (...)`), so covers are never swept.
- **Deletion:** in `deleteEventAction` (and the `cleanup-on-event-delete` worker), if the event has a `cover_path`, add it to the storage paths removed.

## Risks / Trade-offs

- **Cron regression risk** (deleting live covers, or keeping real orphans) → the cover exclusion is a single additional membership check against `events.cover_path`; covered by a regression test that the sweep keeps a cover path and still deletes a true orphan.
- **Cover leaks a sale original?** → No: the cover is a separately uploaded image, intentionally shown un-watermarked; it is never one of the for-sale photos.
- **Partial failure during create** (event created, cover upload fails) → event is kept with null cover (fallback to first photo); non-blocking toast; no orphan-discard. Explicitly specified.
- **Extra query per card list** to resolve covers → negligible at current scale; the builders already do a photos fetch per list.

## Migration Plan

- Add `events.cover_path text` via `supabase/migrations/` (idempotent-friendly `add column if not exists`). Applied to prod by `migrate.yml` on merge. No backfill — existing events keep null and fall back to first photo.
- Rollback: the column is additive and nullable; reverting the app code makes it inert. No data migration to undo.

## Open Questions

- None blocking. Event-detail cover change/removal is deferred to a follow-up ticket (noted as a Non-Goal).
