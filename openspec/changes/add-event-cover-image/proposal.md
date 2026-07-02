## Why

Event cards across the app show a cover image, but photographers can't choose it — the cover is silently auto-picked as the *first* photo of the event. There's no way to set a proper presentation image, which matters for launch: a good cover is what sells an event in the listings. The user asked for a **dedicated presentation image per event, configurable when creating the event**.

## What Changes

- Add a **dedicated cover image** per event: the photographer uploads a presentation/banner image (separate from the for-sale photos), and it becomes the card image everywhere.
- New `events.cover_path` column (nullable). When unset, behavior is unchanged (falls back to the first photo) — **no regression** for existing events.
- The cover is uploaded in the **create-event wizard** (step 2 / details). It's stored in the existing private `photos` bucket under the event folder and served to cards via short-lived signed URLs, shown un-watermarked (it's a chosen presentation image, not a sale photo, so no paid-original leak).
- A server action uploads/replaces/removes the cover (owner-only), validated through `validatePhotoUpload` (magic bytes, 50 MB cap).
- The ~6 cover-URL builders prefer `cover_path` over the first photo when set.
- **Storage-lifecycle safety** (correctness, not optional): the orphan-cleanup cron must NOT sweep cover objects (they have no `photos` row), and event deletion must remove the cover object.
- Out of scope (follow-up ticket): changing/removing the cover from the event edit/detail page after creation. This change covers create + display + lifecycle safety.

## Capabilities

### New Capabilities
- `event-cover-image`: A photographer can attach one dedicated presentation image to an event; it is the cover shown on all event cards, with a safe storage lifecycle (protected from the orphan sweep, cleaned up on delete) and a graceful fallback to the first photo when unset.

### Modified Capabilities
<!-- No existing OpenSpec capability specs to amend (openspec/specs/ is empty). -->

## Impact

- **DB / migration:** new `events.cover_path text` column (`supabase/migrations/`), applied to prod by `migrate.yml` on merge.
- **Storage:** cover objects in the `photos` bucket under `${ownerId}/${eventId}/cover-${uuid}.${ext}`.
- **Server actions / queries:** new cover upload action; `events` queries select `cover_path`; the ~6 cover-URL builders (`dashboard/photographer/actions.ts`, `top-events-actions.ts`, `dashboard/talent/events/actions.ts`, `actions/saved-events.ts`, `photographer/[slug]/actions.ts`, `dashboard/photographer/events/page.tsx`).
- **Wizard:** `events/new/` (new cover field + upload-after-create wiring; must not trigger the T-054 orphan-discard).
- **Cron / deletion:** `cleanup-orphaned-storage.ts` (exclude cover paths), `deleteEventAction` + `cleanup-on-event-delete.ts` (remove cover object).
- **i18n:** new strings in `en.json` + `es.json`. **Validation:** reuses `src/lib/photo-upload.ts`. No new env vars.
