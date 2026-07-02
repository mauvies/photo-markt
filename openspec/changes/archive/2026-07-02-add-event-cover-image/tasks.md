## 1. Database

- [x] 1.1 Add migration `supabase/migrations/20260702000001_add_cover_path_to_events.sql`: `alter table events add column if not exists cover_path text;`

## 2. Query + storage layer

- [x] 2.1 In `src/database/queries/events.ts`: added `getEventCoverPath`, `setEventCoverPath` (owner-scoped), `getEventsCoverPaths(client, eventIds)` → `Map<eventId, cover_path>`.
- [x] 2.2 ~~Shared pure cover-resolution helper~~ — **dropped in code review** (`resolveCoverPath` was dead code: the map-overlay in each builder already implements `cover ?? firstPhoto`, incl. cover-only events). Removed the helper + its unit test to avoid false "centralization".

## 3. Cover upload server action

- [x] 3.1 `uploadEventCoverAction(eventId, formData)` in `events/new/actions.ts`: auth + ownership, `validatePhotoUpload`, upload to `photos` at `${ownerId}/${eventId}/cover-<uuid>.<ext>`, delete previous cover on replace, `setEventCoverPath`, revalidate.
- [x] 3.2 `removeEventCoverAction(eventId)` — owner-only, delete object + null the column.

## 4. Wizard integration (create flow)

- [x] 4.1 Cover-image field on step 2 (`step-2-details.tsx`) — pick/preview/clear one image; `File` held in wizard state.
- [x] 4.2 In submit: after `createEvent`, `uploadEventCoverAction` in its own try/catch — failure shows `toast.error` and does NOT hard-stop (no T-054 orphan-discard); event kept with null cover.
- [x] 4.3 New i18n strings in `en.json` + `es.json`.

## 5. Card cover resolution (display)

- [x] 5.1 All 6 cover-URL builders prefer `cover_path` (signed) over the first photo when set, fallback preserved for null. **Also** the public event page OG/social image + JSON-LD (`events/[shareCode]/page.tsx`) — added in code review.

## 6. Storage-lifecycle safety

- [x] 6.1 `cleanup-orphaned-storage.ts`: in-use set includes live `events.cover_path`; **fails safe** on lookup error and filters `deleted_at` (code-review hardening).
- [x] 6.2 `deleteEventAction` removes the cover object (`cleanup-on-event-delete.ts` handles only AWS Rekognition, so no change needed there).

## 7. Tests

- [x] 7.1 ~~Unit test for the pure helper~~ — removed with the helper (2.2). Fallback is covered by the integration test below.
- [x] 7.2 Cover in-use / not-swept mechanism covered by `test/integration/queries/event-cover.test.ts` (cron `.in('cover_path', …)` lookup).
- [x] 7.3 `event-cover.test.ts`: owner sets/reads cover, non-owner is rejected, clear-with-null.

## 8. Verify

- [x] 8.1 `pnpm typecheck && pnpm lint && pnpm test` green (695 tests); new strings in both dictionaries.
- [x] 8.2 Ran `/code-review high` (workflow); fixed all 6 verified findings.
