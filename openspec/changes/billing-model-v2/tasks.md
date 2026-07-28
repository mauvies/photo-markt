<!--
Each numbered group below maps to one implementation child ticket, in executable
order. Capture each with /ticket after the owner approves this design. Every
implementation PR touches payments → /code-review ultra is mandatory. Groups 0
and the final rollout are OWNER gates, not code.
-->

## 0. Prerequisite gate (OWNER — measurement, not code)

- [ ] 0.1 Measure the real Stripe fee distribution from the dashboard for the actual card/currency mix — average AND worst case (domestic EU vs cross-border vs non-EEA card vs Link), including the ~0.5% Connect transfer fee
- [ ] 0.2 Set the worst-case-safe values for `BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS` — validate against the tightest case (Pro 0% commission, €1.50 photo, expensive card) staying ≥ €0
- [x] 0.3 Owner approves this design before any child ticket below is opened — approved 2026-07-28; children opened as T-195 (A) / T-196 (B) / T-197 (C)

## 1. Ticket A — config, calc point, min price, commission rates (dark: fee defaults 0)

- [x] 1.1 Add `BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS` to `env.mjs` (Zod, safe defaults = 0)
- [x] 1.2 Add `getBuyerServiceFeeCents(subtotalCents)` to `src/lib/plans.ts` with the single fixed+percent+round rule; unit tests for combine/round/zero-disable
- [x] 1.3 Lower `PLATFORM_FEE_RATES` to Free 8 / Starter 4 / Pro 0; update any advertised-percent copy that derives from it; unit test asserts `getPhotographerNetCents` per tier
- [x] 1.4 Enforce `MIN_PHOTO_PRICE_CENTS` in the event create + edit actions/schemas (free events exempt; floor=0 disables); regression tests (reject below, accept at/above, exempt free, existing rows untouched)
- [x] 1.5 Reprice Starter — update `plans.ts` display to €9.99/€95.88 (⚠️ recreate the `STRIPE_PRICE_AMATEUR*` Price objects at €9.99 EUR in the Stripe dashboard — deploy prerequisite, not code)

## 2. Ticket B — checkout line item + cart/checkout display (both flows)

- [ ] 2.1 Add the service-fee Stripe `line_item` to the guest checkout (`cart/actions.ts`) from `getBuyerServiceFeeCents` of the validated subtotal; skip when fee = 0
- [ ] 2.2 Add the same to the authenticated checkout (`dashboard/talent/cart/actions.ts`)
- [ ] 2.3 Cart/checkout UI: show subtotal + labeled service-fee line + total, up front; i18n strings (en+es); hidden when fee = 0
- [ ] 2.4 Regression tests: checkout session itemizes the fee and equals `getBuyerServiceFeeCents`; zero-config adds no line item; displayed total = subtotal + fee

## 3. Ticket C — earnings breakdown + i18n polish

- [ ] 3.1 Photographer earnings/sales view: net = `price × (1 − commission)`; buyer fee excluded from the photographer's figure; add any breakdown copy (en+es)
- [ ] 3.2 Regression test: a Pro 0% sale shows net = price and the buyer fee is neither added to nor subtracted from the photographer's total

## 4. Rollout (OWNER gate)

- [ ] 4.1 Ship tickets A–C with fee env = 0 (dark, no buyer-facing change)
- [ ] 4.2 Flip the env vars to the measured worst-case values → v2 goes live; rollback = set them back to 0 (no code revert). Historical orders/earnings not migrated.

## 5. Follow-up (out of scope, capture separately)

- [ ] 5.1 Bundles / "buy all my photos" volume pricing (Sportograf model) — decide before/after v2 goes live; amortizes the fixed fee across more photos
