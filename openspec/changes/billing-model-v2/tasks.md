<!--
Each numbered group below maps to one implementation child ticket, in executable
order. Capture each with /ticket after the owner approves this design. Every
implementation PR touches payments → /code-review ultra is mandatory. Groups 0
and the final rollout are OWNER gates, not code.
-->

## 0. Prerequisite gate (OWNER — measurement, not code)

- [x] 0.1 Measure the real Stripe fee distribution from the dashboard for the actual card/currency mix — average AND worst case (domestic EU vs cross-border vs non-EEA card vs Link), including the ~0.5% Connect transfer fee — **done by the owner (2026-07-29)**
- [ ] 0.2 Set the worst-case-safe values for `BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS` — validate against the tightest case (Pro 0% commission, €1.50 photo, expensive card) staying ≥ €0. **Tracked as T-199**; measurement is done, the numbers still need to be chosen and written into `plans.ts`
- [x] 0.3 Owner approves this design before any child ticket below is opened — approved 2026-07-28; children opened as T-195 (A) / T-196 (B) / T-197 (C)

## 1. Ticket A — config, calc point, min price (dark: fee constants ship at 0)

<!--
Amended during T-195: the commission cut (1.3) moved to ticket B. It is NOT gated
by the fee amounts, so shipping it before the buyer fee is live would settle every
Pro sale at 0% commission while the platform still absorbs Stripe's cost — a loss
on each one. The two halves must deploy together. The Starter reprice (1.5) stays
here: it is a subscription price, not per-sale economics.
-->

- [x] 1.1 Declare `BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS` as named constants in `src/lib/plans.ts`, shipping at 0 (amended from env vars — see the buyer-service-fee spec)
- [x] 1.2 Add `getBuyerServiceFeeCents(subtotalCents)` to `src/lib/plans.ts` with the single fixed+percent+round rule; unit tests for combine/round/zero-disable
- [x] 1.3 **Landed in ticket B (T-196).** Lower `PLATFORM_FEE_RATES` to Free 8 / Starter 4 / Pro 0; update any advertised-percent copy that derives from it; unit test asserts `getPhotographerNetCents` per tier
- [x] 1.4 Enforce `MIN_PHOTO_PRICE_CENTS` in the event create + edit actions/schemas (free events exempt; floor=0 disables); regression tests (reject below, accept at/above, exempt free, existing rows untouched)
- [x] 1.5 Reprice Starter — `plans.ts` display at €9.99/€95.88. Stays in ticket A (unlike 1.3): a subscription price is unrelated to the per-sale commission math, and the `STRIPE_PRICE_AMATEUR*` Price objects were already recreated at €9.99 EUR on 2026-07-28 — so shipping the display change closes a live mismatch rather than opening one

## 2. Ticket B — checkout line item + cart/checkout display + commission cut (both flows)

- [x] 2.1 Add the service-fee Stripe `line_item` to the guest checkout (`cart/actions.ts`) from `getBuyerServiceFeeCents` of the validated subtotal; skip when fee = 0
- [x] 2.2 Add the same to the authenticated checkout (`dashboard/talent/cart/actions.ts`)
- [x] 2.3 Cart/checkout UI: show subtotal + labeled service-fee line + total, up front; i18n strings (en+es); hidden when fee = 0
- [x] 2.4 Land task 1.3 here (commission rates 8/4/0), so the seller economics and the buyer fee go live in the same deploy
- [x] 2.5 Regression tests: checkout session itemizes the fee and equals `getBuyerServiceFeeCents`; zero-config adds no line item; displayed total = subtotal + fee; `getPhotographerNetCents` per tier at the new rates

## 3. Ticket C — earnings breakdown + i18n polish

- [x] 3.1 Photographer earnings/sales view: net = `price × (1 − commission)`; buyer fee excluded from the photographer's figure; add any breakdown copy (en+es)
- [x] 3.2 Regression test: a Pro 0% sale shows net = price and the buyer fee is neither added to nor subtracted from the photographer's total

## 4. Rollout (OWNER gate)

- [x] 4.1 Ship tickets A–C with the fee constants at 0 (dark, no buyer-facing change) — A #258, B #259, C (this change)
- [ ] 4.2 Raise the constants in `src/lib/plans.ts` from 0 to the measured values → v2 goes live; rollback = revert that commit. Historical orders/earnings not migrated. **Tracked as T-199.**

## 5. Follow-up (out of scope, capture separately)

- [ ] 5.1 Bundles / "buy all my photos" volume pricing (Sportograf model) — amortizes the fixed fee across more photos. **Captured as T-200** (the owner wants it soon).
