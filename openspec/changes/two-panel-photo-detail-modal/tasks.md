## 1. Extract shared navigation hooks + PhotoCarousel (no behavior change)

- [ ] 1.1 Create `src/hooks/use-carousel-navigation.ts` — index state, wrap-around `next`/`previous`, current-id emit, preload window via existing `getLightboxWindow`
- [ ] 1.2 Create `src/hooks/use-keyboard-nav.ts` — Escape/ArrowLeft/ArrowRight handlers gated on `open`
- [ ] 1.3 Create `src/hooks/use-image-load.ts` — `loadedIds` set + `markLoaded`, `isLoaded(id)`
- [ ] 1.4 Create shared `src/components/photo-carousel.tsx` — the image + prev/next arrows + swipe/drag + load spinner, using the hooks above; consumed by both the lightbox and the new modal
- [ ] 1.5 Refactor `src/components/photo-lightbox.tsx` to render `PhotoCarousel` + the hooks with no behavior change (overlay, icon toolbar, close/fullscreen stay in the lightbox)
- [ ] 1.6 Add unit tests for each extracted hook (wrap-around, keyboard gating, load tracking) — fail before extraction, pass after
- [ ] 1.7 Run existing lightbox tests to confirm no regression

## 2. CTA derivation helper

- [ ] 2.1 Create a pure `resolvePhotoCta` helper (e.g. `src/lib/photo-detail-cta.ts`) mapping the existing action flags/state to `{ kind: 'add-to-cart' | 'in-cart' | 'download' | 'unavailable'; labelKey; price? }`
- [ ] 2.2 Add unit tests covering the matrix: paid-not-purchased → add-to-cart(+price); in-cart → in-cart; free/collaborative downloadable → download; purchased → download; guest gating — fail before, pass after

## 3. PhotoDetailModal component

- [ ] 3.1 Create `src/components/photo-detail-modal.tsx` on Shadcn `Dialog`, rendering the shared `PhotoCarousel` on the left, accepting the same prop contract as `PhotoLightbox` plus panel data (`pricePerPhoto`)
- [ ] 3.2 Desktop split layout: `PhotoCarousel` left; fixed-width white info/CTA column right; share icon top-right of the image; `n / total` counter far top-right
- [ ] 3.3 Mobile stacked layout: image top, info/CTA panel below, thumb-reachable primary button, `env(safe-area-inset-*)` respected
- [ ] 3.4 Right panel order: attribution (reuse `PhotoUploaderIndicator`/`PhotoUploaderInfo`) → location → date → dimensions `W × Hpx` → "Price per Photo" label → `<amount> USD` → primary CTA (from `resolvePhotoCta`) at the bottom
- [ ] 3.5 Close (button/backdrop/Escape) returns to the gallery

## 4. Surface wiring via detailVariant

- [ ] 4.1 Add `detailVariant?: 'lightbox' | 'purchase'` (default `'lightbox'`) to `src/components/photo-album-viewer.tsx`; mount `PhotoDetailModal` on `'purchase'`, forwarding the existing handler/flag props
- [ ] 4.2 Opt in the public event viewer (`events/[shareCode]`) **only for paid events** (`price_per_photo != null`); free events stay `'lightbox'`; confirm face+bib search paths open the modal
- [ ] 4.3 Opt in the talent dashboard event viewer (`dashboard/talent/events/[id]`) **only for paid events**
- [ ] 4.4 Confirm the AI face-search results path (bucketed sections through `PhotoGallery`) opens the modal with the correct combined index
- [ ] 4.5 Leave the photographer viewer (`dashboard/photographer/events/[id]`) on the default `'lightbox'` — role actions, no purchase CTA

## 5. i18n + quality gates

- [ ] 5.1 Add new strings to `en.json` + `es.json` (panel labels: dimensions, price, counter; primary/secondary CTA labels incl. report)
- [ ] 5.2 `pnpm typecheck` green
- [ ] 5.3 `pnpm lint` green
- [ ] 5.4 `pnpm test` green (new hook + CTA tests included)

## 6. Manual verification (user)

- [ ] 6.1 User verifies the modal on real iOS Safari and Android Chrome (layout, safe-area, thumb reach, prev/next, CTA correctness) before merging the draft PR
