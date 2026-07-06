## Why

On the purchase/browse surfaces, opening a photo shows a full-screen lightbox whose only affordances are small icon buttons in a top toolbar — a poor "moment of conversion". Sports-photo marketplaces present a two-panel detail view (large image + a dedicated info/CTA column) that surfaces price, attribution, and a prominent buy button. T-066 introduces that pattern for the talent/public purchase surfaces while leaving the existing lightbox intact for other uses.

## What Changes

- Add a new **two-panel photo-detail modal** (`PhotoDetailModal`), built on the existing Shadcn `Dialog`:
  - **Desktop**: split layout — large image with prev/next on the left; a fixed-width info/CTA column on the right (uploader attribution, location, date, dimensions e.g. `5776 × 4336px`, price per photo, a large prominent primary CTA, secondary actions (share, report), and an `X / Y` counter).
  - **Mobile**: stacked — image on top, info/CTA panel below with a thumb-reachable primary button; safe-area insets respected.
  - No secondary full-screen zoom layer (talent photos are watermarked + downscaled).
- **Extract** the shared navigation/interaction logic currently inlined in `photo-lightbox.tsx` into reusable hooks (`useCarouselNavigation`, `useKeyboardNav`, `useImageLoad`, and a swipe helper) consumed by **both** the existing lightbox (refactor, no behavior change) and the new modal — no duplication.
- **Reuse** the existing per-viewer CTA/permission matrix: the new modal accepts the same action props (visibility flags, per-photo gates, callbacks, state sets) the viewers already compute for the lightbox — the primary CTA is derived from those flags, not re-implemented.
- Add a `detailVariant: 'lightbox' | 'purchase'` switch to `PhotoAlbumViewer` so the **talent**, **public**, and **AI face-search** surfaces opt into the new modal while the **photographer** surface keeps its existing lightbox/role-action treatment.
- New i18n strings in `en.json` + `es.json` for the info-panel labels, primary/secondary CTAs, counter, and report action.

## Capabilities

### New Capabilities
- `photo-detail-modal`: the conversion-focused two-panel photo detail view for purchase/browse surfaces — its layout (desktop split / mobile stacked), the info-panel content, the conditional primary CTA reused from the existing action matrix, navigation (prev/next, keyboard, close-to-gallery), and the shared extracted hooks. Also covers the invariant that the existing lightbox is preserved for the photographer and other surfaces.

### Modified Capabilities
<!-- None: no existing spec governs the photo lightbox/viewer; its navigation logic is being refactored into shared hooks with no behavior change, which is an implementation detail, not a spec-level requirement change. -->

## Impact

- **New**: `src/components/photo-detail-modal.tsx`; extracted hooks under `src/hooks/` (`use-carousel-navigation.ts`, `use-keyboard-nav.ts`, `use-image-load.ts`, swipe helper); unit tests for the hooks + the CTA-label derivation.
- **Modified**: `src/components/photo-lightbox.tsx` (consume the extracted hooks, no behavior change); `src/components/photo-album-viewer.tsx` (add `detailVariant` switch, mount the modal on `'purchase'`); the talent (`dashboard/talent/events/[id]`) and public (`events/[shareCode]`) viewers + the AI face-search path opt in; `src/dictionaries/en.json` + `es.json`.
- **Unchanged**: the photographer event viewer (`dashboard/photographer/events/[id]`) and its role-action lightbox; the action set + permission rules (reused, not changed); pricing/discount logic (flat `price_per_photo`, no volume discount exists); the image-load pipeline; the existing lightbox as used by other surfaces.
- **Out of scope / manual**: real iOS Safari + Android Chrome device verification is performed by the user before merging the draft PR.
