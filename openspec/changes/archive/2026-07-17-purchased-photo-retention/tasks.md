## 1. Migration

- [x] 1.1 Add `photos.deleted_at timestamptz null` (additive, idempotent).
- [x] 1.2 Drop + recreate `photos_event_approved_taken_idx` as `(event_id, taken_at, id) WHERE upload_status='approved' AND deleted_at IS NULL`.

## 2. Query-layer helpers (`src/database/queries/photos.ts`)

- [x] 2.1 `getSoldPhotoIds(admin, photoIds)` — subset of ids present in `order_items` OR `guest_order_items`.
- [x] 2.2 `isPhotoSold(admin, photoId)` — convenience wrapper.
- [x] 2.3 `softDeletePhotosByIds(admin, photoIds)` — set `deleted_at = now()`.

## 3. EXCLUDE read sites — add `deleted_at IS NULL`

- [x] 3.1 `photos.ts`: getPhotosUploadedCount, getStorageUsageBytes, countEventPhotos, getPhotosForEvents, getPhotosForEventsIncludingPending, getPhotoCountsForEvents, getEventPhotos, getEventPhotosPublic, getEventPhotosPublicPage, getEventPhotosPage, countEventPhotosByStatus, getUploadedPhotoIdsForUserInEvent, getPurchasablePhotoIds.
- [x] 3.2 `bib-numbers.ts` getEventBibDetectionProgress; `rekognition.ts` getPhotoFacesByEventId + getEventAiIndexingProgress.
- [x] 3.3 `event-covers.ts` resolveEventOgImageUrl; `photographers.ts` getPhotographerBySlug photoCount.
- [x] 3.4 `carts.ts` getCartItemsWithDetails + getCartItemCount; `talent-photo-tags.ts` getTaggedPhotosForTalent + getTaggedPhotosCountForTalent.
- [x] 3.5 Non-query reads: `dashboard/photographer/actions.ts` total count, `dashboard/photographer/profile/actions.ts` total count, `talent/cart/actions.ts` add-to-cart lookup (+ merge parity).

## 4. INCLUDE reads — verify NO `deleted_at` filter (buyer access)

- [x] 4.1 Confirm `orders.getPurchasedPhotoIdsForEvent`, `talent-library` (purchased/claimed), `getPhotoForDownload`, guest token page stay unfiltered; add a clarifying comment.
- [x] 4.2 `cleanup-orphaned-storage.ts` in-use set stays unfiltered (soft-deleted storage never swept) — add a guard comment.

## 5. Delete paths purchase-aware + graceful UX

- [x] 5.1 `deletePhotoAction` + `updateEventAction` inline delete (edit/actions.ts): sold → soft-delete (retain storage); else hard-delete as today. Return `{ retained }`.
- [x] 5.2 `deleteContributorPhotoAction` (shareCode/actions.ts): same branch.
- [x] 5.3 `deleteEventAction`: stamp `deleted_at` on the retained sold rows (already excluded from hard-delete + storage removal).
- [x] 5.4 Bulk album fan-out: aggregate retained count; new en/es toast strings for "kept for the buyer".

## 6. ZIP download route

- [x] 6.1 `api/events/[id]/download/route.ts`: don't 404 a buyer's purchased items when `events.deleted_at` is set (gate owner/free all-access on the event being live; buyer path via the purchased set regardless); update the stale "no deleted_at column" comment; do NOT add a `photos.deleted_at` filter to the photo load.

## 7. Tests + verification

- [x] 7.1 Per delete path: sold → soft-delete + row/storage retained; unsold → hard-delete + storage removed.
- [x] 7.2 Buyer-access-after-deletion e2e: buy → delete event/photo → buyer still sees in library/orders + can download (single + ZIP); photo gone from public gallery, search, cart-add, cover.
- [x] 7.3 Orphan-cleanup keeps a soft-deleted photo's storage in-use.
- [x] 7.4 `pnpm typecheck && pnpm lint && pnpm test` + `pnpm build`; then `/code-review` (DB/migration + charge-adjacent) and fix real findings.
