# purchased-photo-retention Specification

## Purpose

Guarantee that a photo a buyer has paid for stays accessible to that buyer forever, regardless of the photographer later deleting the photo or the event. Deleting a sold photo soft-deletes it (retains the row and storage) and hides it from every photographer/public/search/cart surface, while buyer-facing reads and downloads keep resolving it. The `ON DELETE RESTRICT` foreign keys remain a hard fail-safe backstop and `orders`/`order_items` are never mutated.

## Requirements

### Requirement: Sold photos are soft-deleted, never destroyed
When a photographer deletes a photo through any path (single delete, inline delete during event edit, bulk delete, or collaborator/contributor delete), the system SHALL determine whether the photo has been sold — it appears in a completed `order_items` OR `guest_order_items` row — and, if so, SHALL soft-delete it (set `photos.deleted_at`, retain the row and the storage object) instead of hard-deleting. Unsold photos SHALL continue to be hard-deleted with their storage object removed. The `ON DELETE RESTRICT` foreign keys remain as a hard fail-safe backstop, and `orders` / `order_items` rows are never deleted or altered.

#### Scenario: Deleting a sold photo retains it
- **WHEN** a photographer deletes a photo that appears in a completed order
- **THEN** the photo's row is kept with `deleted_at` set, its storage object is retained, and the caller receives a "kept for the buyer" result instead of a foreign-key error

#### Scenario: Deleting an unsold photo hard-deletes it
- **WHEN** a photographer deletes a photo that has never been purchased
- **THEN** the photo row is removed and its storage object is deleted, exactly as before

#### Scenario: Contributor deleting a sold photo retains it
- **WHEN** a collaborator/contributor deletes a photo that has been sold
- **THEN** the photo is soft-deleted (row + storage retained) rather than hard-deleted

### Requirement: Event deletion retains sold photos uniformly
When a photographer deletes an event, the system SHALL keep the rows and storage of that event's sold photos and SHALL stamp `deleted_at` on those retained sold photos, while the event itself remains soft-deleted. Unsold photos of the event SHALL be hard-deleted with their storage removed.

#### Scenario: Event delete keeps sold photos and stamps deleted_at
- **WHEN** a photographer deletes an event containing both sold and unsold photos
- **THEN** the sold photos are retained with `deleted_at` set and their storage kept, the unsold photos and their storage are removed, and the event is soft-deleted

### Requirement: Soft-deleted photos are hidden from all non-buyer surfaces
The system SHALL exclude soft-deleted photos (`deleted_at IS NOT NULL`) from every photographer-facing, public, and discovery surface: photographer dashboard grids and counts, storage-usage/quota totals, the per-event upload cap count, the public and talent event galleries and their pagination, bib-number and face search results, add-to-cart and the rendered cart and cart badge, the event cover / `og:image` fallback, the public photographer profile photo count, and favorites (tagged) galleries.

#### Scenario: Soft-deleted photo disappears from the public gallery
- **WHEN** a sold photo is soft-deleted and a visitor loads the public event page (or the talent event view)
- **THEN** the photo does not appear in the gallery, its pagination, the "total photos" count, or bib/face search results

#### Scenario: Soft-deleted photo cannot be added to a cart
- **WHEN** a talent attempts to add a soft-deleted photo to their cart
- **THEN** the add is rejected and the photo is treated as not purchasable

#### Scenario: Soft-deleted photo is not a cover or social image
- **WHEN** an event's cover/`og:image` fallback would resolve to the first photo and that photo is soft-deleted
- **THEN** the soft-deleted photo is not used as the cover or OG image

#### Scenario: Soft-deleted photo does not count against quota
- **WHEN** storage usage or the per-event photo cap is computed for a photographer
- **THEN** soft-deleted photos are not counted

### Requirement: Buyers retain access to purchased photos after deletion
The system SHALL keep soft-deleted photos visible and downloadable to their buyers. The purchased library, orders previews, single-photo download authorization, and the guest download-token page SHALL continue to resolve soft-deleted photos. The orphaned-storage-cleanup job SHALL continue to treat a soft-deleted photo's storage path as in-use so it is never swept. The ZIP bulk-download route SHALL allow a buyer's purchased photos even when the event has been soft-deleted. A download path's owner/free all-access branch SHALL NOT serve a soft-deleted photo — only the buyer's purchased-set path may.

#### Scenario: Buyer sees a purchased photo after the photographer deletes it
- **WHEN** a buyer purchased a photo and the photographer later deletes the photo or the event
- **THEN** the photo still appears in the buyer's profile library and orders, and the buyer can download it (single and ZIP)

#### Scenario: Cleanup cron never sweeps a retained photo's storage
- **WHEN** the orphaned-storage-cleanup job runs after a sold photo is soft-deleted
- **THEN** the retained photo's storage object is recognized as in-use and is not deleted

#### Scenario: ZIP download works after whole-event deletion
- **WHEN** a buyer requests a ZIP of their purchased photos for an event the photographer soft-deleted
- **THEN** the route returns the buyer's purchased photos rather than a 404

#### Scenario: A retained photo is not exposed by the free/owner all-access branch
- **WHEN** a paid event with a soft-deleted (sold) photo is switched to free and a non-buyer requests that photo's download
- **THEN** the download is denied, while the photo's buyer can still download it
