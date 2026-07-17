## Why

A buyer who paid for a photo has permanent rights to that content — the photographer's later actions must never remove the buyer's access. Today a purchased photo's bytes are protected only by the `ON DELETE RESTRICT` FK on `order_items.photo_id` / `guest_order_items.photo_id` plus a single purchase-aware guard in the event-delete path. The individual, bulk, and contributor photo-delete paths are **not** purchase-aware — deleting a sold photo fails with a raw Postgres FK error (ungraceful; no data loss only thanks to the FK), and a buyer's ZIP download 404s after the photographer soft-deletes the event. This is pre-first-sale hardening (0 real sales in prod), but it must hold before the first real sale.

## What Changes

- Add a `photos.deleted_at` timestamp — a **soft-delete** state for photos.
- When a photographer deletes a photo that has been **sold** (appears in a completed `order_items` or `guest_order_items`), soft-delete it (set `deleted_at`, **keep the row and the storage object**) instead of hard-deleting. Unsold photos hard-delete exactly as today.
- Apply this to every delete path: single (`deletePhotoAction`), the inline per-photo delete during event edit (`updateEventAction`), bulk (client fan-out over the single action), collaborator/contributor (`deleteContributorPhotoAction`), and whole-event (`deleteEventAction` — already retains sold rows + storage; additionally stamp `deleted_at` on them for a uniform invariant).
- Hide soft-deleted photos from every photographer / public / gallery / search / cart / cover surface (add `deleted_at IS NULL` to the enumerated read sites).
- Keep soft-deleted photos visible **only** to the buyer: purchased library, orders previews, single-photo download authorization, guest download-token page, and the orphaned-storage-cleanup cron's in-use set (their storage must never be swept).
- Relax the ZIP download route's `events.deleted_at IS NULL` gate so a buyer keeps bulk-download access to purchased photos after a whole-event soft-delete.
- Keep the FK `ON DELETE RESTRICT` as a hard fail-safe backstop. Never delete or alter `orders` / `order_items`.
- Graceful UX: a sold-photo delete reports "kept for the buyer" instead of erroring (new en/es strings).

## Capabilities

### New Capabilities
- `purchased-photo-retention`: purchased photos survive any photographer deletion (soft-delete + retain), stay accessible to the buyer forever, and disappear from all photographer/public/search/cart surfaces.

### Modified Capabilities
<!-- None: the cart/gallery/search visibility changes are the implementation of this new capability's "hidden everywhere except the buyer" requirement, not new requirements on those existing specs. -->

## Impact

- **Migration:** `photos.deleted_at timestamptz null`; recreate the hot gallery partial index `photos_event_approved_taken_idx` as `(event_id, taken_at, id) WHERE upload_status='approved' AND deleted_at IS NULL`. The FK backstop is unchanged.
- **Query layer (`src/database/queries/`):** new `getSoldPhotoIds` / `softDeletePhotosByIds` / `isPhotoSold` helpers in `photos.ts`; `deleted_at IS NULL` added to the EXCLUDE read sites across `photos.ts`, `bib-numbers.ts`, `rekognition.ts`, `event-covers.ts`, `photographers.ts`, `carts.ts`, `talent-photo-tags.ts`. Buyer-facing reads (`orders.ts`, `talent-library.ts`, `getPhotoForDownload`, cleanup cron) deliberately unfiltered.
- **Server Actions:** `deletePhotoAction` + `updateEventAction` (edit), `deleteContributorPhotoAction`, `deleteEventAction` made purchase-aware; return a "retained" signal; new i18n strings.
- **API route:** `src/app/api/events/[id]/download/route.ts` — relax the event `deleted_at` gate for the purchased-photo path.
- **Non-query reads:** photographer dashboard/settings photo counts, talent add-to-cart lookup gain the filter.
- **Payments/security-sensitive** (charge-adjacent delete + migration) → `/code-review` before commit.
