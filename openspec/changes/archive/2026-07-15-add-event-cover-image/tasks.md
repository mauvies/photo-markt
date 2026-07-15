## 1. Database

- [ ] 1.1 Add migration `supabase/migrations/<ts>_add_cover_path_to_events.sql`: `alter table events add column if not exists cover_path text;`

## 2. Query + storage layer

- [ ] 2.1 In `src/database/queries/events.ts`: add `cover_path` to the `EventRow`/select shapes that feed cover builders; add `setEventCoverPath(supabase, eventId, userId, path | null)` (owner-scoped update) and `getEventsCoverPaths(client, eventIds)` → `Map<eventId, cover_path>`.
- [ ] 2.2 Add a shared cover-resolution helper (pure where possible): given events + their first-photo paths + cover paths, decide which storage path to sign per event (cover_path when set, else first photo). Unit-testable.

## 3. Cover upload server action

- [ ] 3.1 New owner-only action `uploadEventCoverAction(eventId, formData)`: auth + ownership check, `validatePhotoUpload(file)`, upload to `photos` at `${ownerId}/${eventId}/cover-<uuid>.<ext>` via `uploadFile`, delete the previous `cover_path` object on replace, then `setEventCoverPath`. Revalidate the relevant paths/tags.
- [ ] 3.2 (Optional, same action file) `removeEventCoverAction(eventId)` for symmetry / future edit page — owner-only, delete object + null the column.

## 4. Wizard integration (create flow)

- [ ] 4.1 Add a single cover-image field to step 2 (details) in `events/new/` — pick/preview/clear one image; hold the `File` in wizard state.
- [ ] 4.2 In the submit flow, after `createEvent` returns the `eventId` and before/after the photo upload, call `uploadEventCoverAction`. Wrap in its own try/catch: on failure show `toast.error(...)` and DO NOT flip the upload flow to a hard-stop (must not trigger the T-054 orphan-discard). The event is kept with a null cover.
- [ ] 4.3 New i18n strings in `en.json` + `es.json` (cover field label/help, cover upload failed toast).

## 5. Card cover resolution (display)

- [ ] 5.1 Update the cover-URL builders to prefer `cover_path` (signed) over the first photo when set, using the 2.1/2.2 helpers: `dashboard/photographer/actions.ts`, `top-events-actions.ts`, `dashboard/talent/events/actions.ts`, `actions/saved-events.ts`, `photographer/[slug]/actions.ts`, `dashboard/photographer/events/page.tsx`. Preserve the first-photo fallback exactly for null covers.

## 6. Storage-lifecycle safety

- [ ] 6.1 `cleanup-orphaned-storage.ts`: extend the in-use set to include `events.cover_path` values so covers are never swept.
- [ ] 6.2 `deleteEventAction` and `cleanup-on-event-delete.ts`: if the event has a `cover_path`, include it in the storage objects removed.

## 7. Tests

- [ ] 7.1 Unit test for the cover-resolution helper (2.2): returns cover path when set, first photo when null.
- [ ] 7.2 Regression test that the orphan sweep keeps a `cover_path` object and still deletes a true orphan.
- [ ] 7.3 Test (integration or focused) that `uploadEventCoverAction` rejects a non-owner and sets `cover_path` for the owner; replace deletes the old object.

## 8. Verify

- [ ] 8.1 `pnpm typecheck && pnpm lint && pnpm test` green; new strings present in both dictionaries.
- [ ] 8.2 Run `/code-review` on the diff (touches DB migration + storage lifecycle) and fix real findings.
