## 1. Database

- [x] 1.1 New migration: add `photos.sequence int` and `photos.label text` (nullable)
- [x] 1.2 Add a monotonic per-event counter (`events.photo_sequence_counter`) and a `BEFORE INSERT` trigger that increments it (`UPDATE ... RETURNING`) into `NEW.sequence` when null — never reuses numbers, locks the event row against concurrent collisions (plain function, not SECURITY DEFINER)
- [x] 1.3 Backfill existing rows: `row_number() over (partition by event_id order by created_at, id)`
- [x] 1.4 Add index on `(event_id, sequence)`
- [x] 1.5 `pnpm db:reset` to apply locally

## 2. Queries (database/queries/photos.ts)

- [x] 2.1 Select `sequence` and `label` in `getEventPhotos` (photographer path)
- [x] 2.2 New `updatePhotoLabel(supabase, photoId, eventId, userId, label)` — owner-scoped update, returns void

## 3. Server Action

- [x] 3.1 `updatePhotoLabelAction(photoId, eventId, label)` in the photographer event `edit/actions.ts`: auth + `getEvent(supabase, eventId, user.id)` ownership check, validate (trim, ≤50, empty → null), call `updatePhotoLabel`, revalidate

## 4. UI (photographer album only)

- [x] 4.1 Thread `code` (label ?? `#${sequence}`) onto the photographer `PhotoAlbumItem` build in `page.tsx`
- [x] 4.2 Render the code as a small badge on each tile in the photographer album, plus an edit affordance (dialog/input) wired to `updatePhotoLabelAction`
- [x] 4.3 Optimistic update of the displayed code on save; keep talent/public views unchanged (no code passed)

## 5. i18n

- [x] 5.1 Add strings to `en.json` and `es.json` (edit code label, placeholder, save/cancel, too-long error, success/error toasts)

## 6. Tests

- [x] 6.1 Integration: uploading photos auto-assigns increasing per-event sequence (owner + guest); deletion leaves a gap
- [x] 6.2 Integration: `updatePhotoLabel` / `updatePhotoLabelAction` — owner can set/clear, non-owner is rejected
- [x] 6.3 `pnpm typecheck && pnpm lint && pnpm test` green

## 7. Wrap-up

- [x] 7.1 Commit (Conventional Commits, no Co-Authored-By), push, open draft PR (English)
- [x] 7.2 `/opsx:archive` the change
