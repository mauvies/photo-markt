## Context

Per-sale economics today (v1): buyer pays `price_per_photo`; photographer receives `price × (1 − commission)` (commission 12/8/5% by tier); the platform absorbs both the Stripe processing fee and the ~0.5% Connect transfer fee. Because the commission is percent-only and Stripe's fee is fixed+percent, small sales lose money (break-even ~€2.50–3.00). Currency was just fixed to EUR (T-193), removing the ~2% conversion fee. The full analysis, competitor survey, and PSD2 legal basis live in `docs/BILLING_MODEL.md` — this document captures the technical decisions that turn that model into code. Commission math already has a single source of truth: `src/lib/plans.ts` (`getPhotographerNetCents`, `PLATFORM_FEE_RATES`).

## Goals / Non-Goals

**Goals:**
- No sale is ever sold at a loss, at any tier, including the tightest case (Pro 0% commission, expensive non-EEA card).
- Fees as low as possible for buyer and photographer; profit weight moves to subscriptions.
- The exact fee/price numbers can be tuned after a real measurement **without a code change**.
- The fee is computed in exactly one place and disclosed lawfully (up-front total).

**Non-Goals:**
- Bundles / "buy all my photos" volume pricing (follow-up; highest-leverage but independently large).
- Multi-currency / per-country presentment (deferred — re-introduces FX; see `docs/BILLING_MODEL.md`).
- The append-only ledger (T-190, separate change) — v2 works with the current per-order transfer.
- Choosing the *final* numbers here — those come from the owner's Stripe-fee measurement.

## Decisions

**D1 — The fixed fee goes on the BUYER, not the seller.** A buyer service fee keeps the photographer's payout clean and turns the commission into pure margin. It mirrors the vertical (surfcloud flat $3+5%, Sportograf ~6% buyer fee) and is lawful in the EU (flat uniform service fee ≠ PSD2 card surcharge). Alternative (fixed fee on the seller / lower payout) rejected: photographers are the scarce side early on; a smaller payout is a worse supply signal than a small buyer fee.

**D2 — Fee = fixed + percent, ENV-configurable.** `getBuyerServiceFeeCents(subtotalCents)` = `BUYER_SERVICE_FEE_FIXED_CENTS + round(subtotalCents × BUYER_SERVICE_FEE_BPS / 10000)`. Env, not constants, because the correct fixed value depends on a measurement not yet done and will be re-tuned; a code deploy per tweak is wasted friction (same pattern as the T-034 face-search caps). Provisional: `FIXED=30` (€0.30), `BPS=150` (1.5%). Validated in `env.mjs` (T3 Env / Zod), with safe defaults.

**D3 — One calc point.** `getBuyerServiceFeeCents` lives beside `getPhotographerNetCents` in `src/lib/plans.ts`. Checkout, cart display, and earnings all call it; the fee is **never** re-derived inline (the same discipline CLAUDE.md mandates for `getPlatformFeeRate`). This keeps "what the buyer is charged" and "what's displayed" provably identical.

**D4 — Separate, visible Stripe line item + up-front disclosure.** The fee is added as its own `line_item` (`price_data`, product name e.g. "Service fee") in both checkout sessions, so the Stripe receipt itemizes it. The cart/checkout UI shows `subtotal + service fee = total` **before** the final step. The legal risk is disclosure, not the fee's existence — so the total-with-fee must be visible up front, never a surprise at the last step.

**D5 — Commission reduction is coupled and modeled with the other two knobs.** Moving Stripe onto the buyer frees the commission of a cost it no longer carries; that saving is passed to the photographer: **Free 8 / Starter 4 / Pro 0%**. Because Pro at 0% makes both tier break-evens collapse onto one GMV point, **Starter is repriced €14.99 → €9.99** (commission unchanged) so each tier owns a band (Free <€250 · Starter €250–500 · Pro >€500/mo). The three knobs (buyer fee, commission, sub price) are tuned **together**; one-at-a-time fails (the Starter-dominance math is the proof). Rates change in `PLATFORM_FEE_RATES`; Starter price via the existing `STRIPE_PRICE_AMATEUR*` env price IDs (must be recreated in Stripe at €9.99 — a dashboard action, like the T-193 subscription-currency step).

**D6 — Minimum photo price, env-configurable, enforced at write time.** `MIN_PHOTO_PRICE_CENTS` (provisional 150) enforced in the event create + edit actions/schemas (where `price_per_photo` is set), not as a DB constraint (mirrors how other price/session rules are app-level). A free event (`price_per_photo = null/0`) is exempt — the floor applies only to priced photos.

**D7 — The fixed fee is sized to the WORST realistic case, and Pro 0% is the binding constraint.** With Pro at 0% commission the buyer fee is the *only* thing covering Stripe on a Pro sale. Worst case ≈ non-EEA card ~3.25% + €0.25 Stripe fixed + ~0.5% Connect transfer. The measurement task must set `FIXED` (likely ~€0.35–0.40) so even a €1.50 Pro sale on an expensive card stays ≥ €0 for the platform. This is a *sizing method*, not a number — the number is the owner's to set from measured data.

**D8 — Earnings breakdown reflects clean margin.** The photographer's earnings view shows the commission as margin that Stripe no longer eats (their net is `price × (1 − commission)` unchanged in formula, but the platform's economics are healthy). The buyer service fee is platform revenue, not part of the photographer's cut — the breakdown must not imply the photographer receives or pays it.

**D9 — Kill-switch = defaults.** `FIXED=0, BPS=0` reproduces v1 buyer-facing behavior (no fee line item, no display) — a clean disable if conversion craters. `MIN_PHOTO_PRICE_CENTS=0` disables the floor. So the change ships dark-able.

## Risks / Trade-offs

- **A buyer fee can lower conversion** (Airbnb reverted buyer→seller fees in 2025). → The magnitude here is small (€1–15 items, sub-€0.50 fee) and the vertical already charges buyers (surfcloud/Sportograf). Ship env-gated; A/B and measure conversion once there's real traffic; the kill-switch (D9) is the escape hatch.
- **Pro 0% can go slightly negative on an expensive card if the fixed fee is undersized.** → D7 sizes the fixed part to the worst case; the measurement gate is mandatory before enabling.
- **Minimum price adds friction / breaks existing sub-floor events.** → Enforced only at write time (create/edit), so existing rows are untouched until edited; floor is env-tunable and free events are exempt.
- **Displayed fee vs charged fee drift.** → D3 (single calc point) makes them the same function; regression tests assert the checkout line item equals `getBuyerServiceFeeCents`.
- **Starter €9.99 requires recreating the Stripe Price object** (currency + amount). → Same manual Stripe step already flagged in T-193; documented as a deploy prerequisite, not code.

## Migration Plan

1. **Measure** the Stripe fee distribution (owner, dashboard) → set the three env vars to worst-case. *Gate.*
2. Ship child ticket A (config + `getBuyerServiceFeeCents` + min-price + reduced rates) with fee **defaulting to 0** (dark).
3. Ship B (checkout line item + display) and C (earnings breakdown + i18n) behind the same env — still 0, so no buyer-facing change yet.
4. Recreate the Starter Stripe Price at €9.99 (dashboard).
5. Flip the env vars on to the measured values → v2 goes live. Rollback = set them back to 0 (D9), no code revert.
6. Historical orders/earnings are **not** migrated — v2 applies going forward.

## Open Questions

- Final measured numbers for `FIXED` / `BPS` / `MIN_PHOTO_PRICE_CENTS` (owner, from Stripe data).
- Does Free stay at 8% after measurement, or does the worst-case math force a small floor there too?
- Bundles: confirmed follow-up — but before or after v2 goes live? (AOV amortizes the fixed fee, so there's an argument to fast-follow.)
- Should the service fee itself carry the tier discount (e.g. lower % for Pro buyers' events), or stay flat across tiers? (Provisional: flat — simpler, and the fee funds Stripe, not margin.)
