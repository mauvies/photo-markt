## Context

Today every photo-browsing surface funnels through one stack:
`PhotoGallery` → `src/components/photo-album-viewer.tsx` (`PhotoAlbumViewer`) → `src/components/photo-lightbox.tsx` (`PhotoLightbox`). The lightbox is a hand-rolled `createPortal` overlay (not a Shadcn Dialog) whose actions are small icons in a top toolbar (`lightbox-toolbar.tsx`).

Crucially, **the lightbox already receives the full CTA/permission matrix as props** from each viewer: visibility flags (`showDownload`, `showAddToCart`, `showRemove`, `showTagTalent`), a per-photo download gate (`canDownloadPhoto(id)`), callbacks (`onAddToCart`, `onDownload`, `onAddToPhotos`, `onRemove`, `onTagTalent`, `onShare`, `onClaimToProfile`), and state sets (`photosInCart`, `photosInMyPhotos`, `claimedIds`). The branching that decides *which* action a photo gets (`isPhotoDownloadable`, `showCartFor`, `canClaimToProfile`, guest-vs-auth cart) is computed **per viewer** and passed down — it is not centralized. Only `src/lib/event-bulk-actions.ts` is shared.

Constraints: reuse Shadcn only (no new UI libs); strings in `en.json` + `es.json`; no `any`; the existing lightbox must stay working for the photographer surface and any other use.

## Goals / Non-Goals

**Goals:**
- A conversion-focused two-panel `PhotoDetailModal` for the talent/public/AI-search surfaces (desktop split, mobile stacked, safe-area aware).
- Reuse the existing per-viewer action matrix by having the modal accept the **same prop contract** the lightbox already gets — the primary CTA is *derived* from those props.
- Extract the lightbox's navigation/keyboard/image-load logic into shared hooks used by both components (no duplication, no behavior change to the lightbox).
- Select per surface via a `detailVariant` switch on `PhotoAlbumViewer`.

**Non-Goals:**
- Secondary full-screen zoom layer (explicitly unwanted — watermarked, downscaled images).
- Changing the action set / permission rules, the pricing/discount logic (flat `price_per_photo`, no volume discount exists), or the image-load pipeline.
- Reworking the photographer surface — it keeps the existing lightbox with role actions.
- Removing or restyling the existing lightbox.

## Decisions

### 1. New component, shared prop contract — not a lightbox mode
`PhotoDetailModal` is a **separate** component that accepts a superset of the lightbox's existing props (same items type `PhotoLightboxItem`, same visibility flags / gates / callbacks / state sets) plus panel data it can read off the item (dimensions, location, date, uploader) and an event-level `pricePerPhoto`. Rationale: the props already encode the full action matrix, so the modal reuses it verbatim; a separate component keeps the lightbox untouched for other surfaces. Alternative considered — a `layout` prop on the lightbox — rejected: it would entangle two very different layouts/portals in one file and risk regressing the widely-used lightbox.

### 2. Primary-CTA derivation is a pure helper
A pure `resolvePhotoCta(photoId, flags/state)` helper maps the existing props to a single `{ kind, labelKey, price? }` describing the primary button (`add-to-cart` | `in-cart` | `download` | `unavailable`). Rationale: it makes the conditional matrix testable (fail-before/pass-after) without a DOM and keeps the JSX declarative. It reads the *same* inputs the lightbox uses (`showAddToCart`, `photosInCart`, `canDownloadPhoto`, purchased/free state surfaced via the download gate) — it does not introduce new rules.

### 3. Extract navigation into hooks under `src/hooks/`
Extract `useCarouselNavigation` (index state, wrap-around prev/next, emits current id, preload window via existing `getLightboxWindow`), `useKeyboardNav` (Escape/Arrow, gated on `open`), and `useImageLoad` (`loadedIds` set + `markLoaded`). Swipe stays a small helper hook (`useSwipeNavigation`) but is only wired into the lightbox initially (the modal can adopt it later without API change). Refactor `PhotoLightbox` to consume these with **no behavior change**, guarded by the existing lightbox tests plus new hook unit tests. Rationale: satisfies the "extract, don't duplicate" requirement and gives both components identical navigation semantics.

### 4. `detailVariant` switch on `PhotoAlbumViewer`
Add `detailVariant?: 'lightbox' | 'purchase'` (default `'lightbox'`). On `'purchase'`, `PhotoAlbumViewer` mounts `PhotoDetailModal` instead of `PhotoLightbox`, forwarding the identical handler/flag props it already assembles. The public + talent viewers (and the AI-search path, which renders through the same `PhotoGallery`) pass `'purchase'`; the photographer viewer passes nothing (stays `'lightbox'`). Rationale: one small, well-typed seam; no viewer needs to duplicate the mount wiring.

### 5. Info panel reuses existing attribution + flat price
Attribution reuses `PhotoUploaderIndicator` / `PhotoUploaderInfo` (name-only, as today — no new profile-link feature). Price shows the flat event `price_per_photo`; there is no volume-discount display to reuse, so none is added (the ticket's "when applicable" resolves to "never, today"). Dimensions come from the item's `width`/`height`. Rationale: reuse existing building blocks; avoid scope creep into new pricing/attribution features.

## Risks / Trade-offs

- **Refactoring the shared lightbox could regress other surfaces** → Extract hooks with byte-for-byte behavior parity, keep the lightbox's public props unchanged, and rely on the existing lightbox integration/unit tests plus new hook unit tests before wiring the modal.
- **Two components now share a prop contract that could drift** → Keep the shared item type and action-prop shape in one place and have both components import it; the CTA helper centralizes the derivation.
- **Layout/UX correctness (safe-area, thumb reach, two-panel proportions) can't be unit-tested** → Explicitly a manual acceptance step: the user verifies on real iOS Safari + Android Chrome before merging the draft PR. The automated tests cover logic (hooks + CTA derivation), not pixels.
- **AI face-search results render bucketed sections** → They already flow through `PhotoGallery`/`PhotoAlbumViewer`, so passing `detailVariant='purchase'` there is sufficient; verify the bucketed path opens the modal with the correct combined index set.

## Migration Plan

1. Land the hook extraction + lightbox refactor first (no behavior change), green tests.
2. Add `PhotoDetailModal` + the CTA helper + tests.
3. Add the `detailVariant` seam and opt in the public, talent, and AI-search surfaces.
4. Draft PR; user performs real-device verification; iterate on layout feedback before merge.
Rollback: revert the `detailVariant` opt-in (surfaces fall back to the untouched lightbox) without reverting the hook extraction.

## Open Questions

- Exact desktop info-column width and whether the report/flag action reuses an existing report flow or is a placeholder — resolve during implementation against existing components; if no report flow exists, ship "report" as a follow-up rather than inventing one.
