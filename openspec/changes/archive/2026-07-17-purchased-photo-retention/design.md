## Context

Purchased photos must remain accessible to the buyer forever, independent of what the photographer does. Today the only hard guarantee is the `ON DELETE RESTRICT` FK on `order_items.photo_id` / `guest_order_items.photo_id`; `deleteEventAction` is the only delete path that gracefully respects it (it excludes sold photos from the hard-delete and keeps their storage). The single/inline/bulk/contributor delete paths hit the FK and fail with a raw error, and the ZIP download route gates on `events.deleted_at IS NULL`, so a buyer loses bulk-download access once the event is soft-deleted. There are 0 real sales in prod, so this is pre-first-sale hardening. Companion PR #202 already fixed the read/RLS side (buyers can see purchased photos); this change fixes the deletion/retention side.

## Goals / Non-Goals

**Goals:**
- A buyer can always view and download a purchased photo, regardless of the photographer deleting the photo or event afterwards.
- Photographer deletion still removes the photo from public galleries, search, carts, covers, and the photographer's own dashboard.
- Every delete path handles a sold photo gracefully (no raw FK error).
- `orders` / `order_items` are never mutated; the FK stays as a backstop.

**Non-Goals:**
- Copy-on-purchase to buyer-owned storage (Option B) — explicitly rejected below.
- Any change to how purchases are recorded or to RLS policies.
- Un-delete / restore of a soft-deleted photo (no product need).
- A per-plan storage-quota redesign (only ensure retained-sold photos don't count).

## Decisions

**Decision: Option A (soft-delete + retain) over Option B (copy-on-purchase).**
The FK `ON DELETE RESTRICT` already makes buyer bytes physically undeletable — a forgotten `deleted_at` filter can only make a soft-deleted photo *reappear on a photographer/public surface* (a visibility bug), never make a buyer *lose* access. Option B would duplicate storage for every sale and add a retried Inngest copy pipeline + backfill + race handling to solve a data-loss problem the FK already solves. A is far lighter and strictly sufficient for the buyer-access guarantee. Trade-off: A's correctness depends on every listing query carrying `deleted_at IS NULL` — mitigated by an exhaustive enumeration (below) and regression tests per surface.

**Decision: `deleted_at` timestamp, not a status enum.** Mirrors `events.deleted_at` (the established soft-delete idiom in this codebase) and composes with the existing `upload_status` lifecycle without overloading it.

**Decision: the sold-check runs on the service-role (admin) client.** `order_items` / `guest_order_items` are RLS-scoped to the buyer, so a photographer's user-scoped client cannot see them. Reuse the existing `getSoldPhotoIdsForEvent` predicate (SOLD = present in either order-items table), generalized to `getSoldPhotoIds(admin, ids)` for the per-photo delete paths; add `isPhotoSold` and `softDeletePhotosByIds` helpers. The soft-delete stamp also runs on admin (avoids depending on a photos UPDATE RLS policy).

**Decision: classify every `photos` read as EXCLUDE / INCLUDE / N-A.** EXCLUDE (add `deleted_at IS NULL`): all photographer/public/gallery/search/cart/cover/quota reads. INCLUDE (must NOT filter): buyer-owned reads (`getTalentPurchasedPhotos`, `getPurchasedPhotoIdsForEvent`, `getPhotoForDownload`, the guest token page) and — critically — the orphaned-storage-cleanup in-use set (`cleanup-orphaned-storage.ts`), where a `deleted_at` filter would delete a buyer's bytes. N-A: writes and id-keyed reads the caller already authorized. The single source of truth for "buyable" is `getPurchasablePhotoIds`, so fixing it covers both checkout paths and the cart self-heal.

**Decision: relax only the ZIP route's event gate, not `getPhotoForDownload`'s.** After a whole-event soft-delete the public event page is unreachable, so the public single-photo download (`getPhotoForDownload`, which gates on `events.deleted_at`) is moot; the buyer's post-deletion single-photo download flows through the profile action (`getPhotoDownloadUrl`, order-scoped, no event gate — already correct via PR #202). Only the ZIP route (`/api/events/[id]/download`) still 404s on `events.deleted_at`, so only it needs to allow the purchased-set path when the event is deleted; owner/free all-access stays gated on the event being live.

**Decision: index.** Recreate the hot gallery partial index `photos_event_approved_taken_idx` as `(event_id, taken_at, id) WHERE upload_status='approved' AND deleted_at IS NULL` so the paginated gallery query (now carrying `deleted_at IS NULL`) stays an ordered index range scan. Non-CONCURRENTLY (tiny table, migrate.yml runs in a transaction) — same rationale as the original index migration.

## Risks / Trade-offs

- **A missed EXCLUDE site → a soft-deleted photo resurfaces in a gallery/search/cart.** → Mitigated by the exhaustive classified enumeration and a regression test asserting soft-deleted photos are absent from the public gallery, cart-add, and covers; `/code-review` as a second pass.
- **A wrongly-added filter on an INCLUDE site → a buyer loses access, or the cleanup cron deletes their bytes.** → The cleanup in-use lookup and buyer-facing reads are explicitly left unfiltered, with comments; a regression test asserts the cron keeps a soft-deleted photo's storage and the buyer can still download after deletion.
- **Optimistic UI in the bulk-delete album drops the tile regardless of soft/hard.** → `router.refresh()` re-hides it (owner gallery becomes EXCLUDE), so the owner-facing result is consistent; the retained-count toast informs the photographer.
- **Storage growth from retained sold photos.** → Bounded to the sold subset; retained photos are excluded from the photographer's quota totals.

## Migration Plan

1. Additive migration: `ALTER TABLE photos ADD COLUMN deleted_at timestamptz;` then drop+recreate `photos_event_approved_taken_idx` with the `AND deleted_at IS NULL` predicate. Idempotent (`IF NOT EXISTS` / `IF EXISTS`). No backfill (all existing rows stay `deleted_at = NULL`). Rollback-inert (dropping the column would just revert to hard-delete-only; no data depends on it yet).
2. Ship query + action + route + UI changes together with the migration in one PR (the migration is applied to prod on merge to main via `migrate.yml`; the Vercel preview build fails until then, per repo norm).

## Review dispositions (`/code-review high`)

Applied: closed two real leaks the review surfaced — the ZIP route and the single-photo public download both served a soft-deleted (sold-and-retained) original through their free/owner all-access branch once a paid event was switched to free; both now exclude `deleted_at IS NOT NULL` from that branch while keeping the buyer's purchased-set path. Fixed a now-stale `event-covers.ts` comment that could invite removing the filter. Batched the per-photo sold-check in `updateEventAction` (was N+1), de-duplicated `getSoldPhotoIdsForEvent` onto `getSoldPhotoIds`, surfaced a "kept for the buyer" notice on the edit-form removal path, corrected the delete-confirm copy, and dropped a stray working-note file.

Accepted (documented, not fixed): the TOCTOU between the sold-check and the hard-delete — if a purchase completes in that window the hard-delete hits the `ON DELETE RESTRICT` FK and surfaces a generic "failed to delete" that succeeds on retry. The critical invariant still holds in the race: the FK **prevents** the destruction, so the buyer never loses data — the backstop doing exactly its job. Detecting the FK to auto-fallback would require fragile error-string matching for a rare, self-healing case, so it's left as-is.

## Open Questions

- None. Approach, scope, and query classification are settled.
