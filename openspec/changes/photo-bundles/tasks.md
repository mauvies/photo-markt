<!--
Each numbered group below maps to one implementation child ticket, in executable
order. Capture each with /ticket after the owner approves this design (group 0).
Every implementation PR touches payments → /code-review ultra is mandatory.
Groups 0 and 4 are OWNER gates, not code.
-->

## 0. Design gate (OWNER — not code)

- [ ] 0.1 Owner approves this design in the PR before any child ticket below is opened
- [ ] 0.2 Owner confirms they still want bundles knowing the economic premise was corrected — the buyer
      service fee is charged **once per checkout**, not once per photo, so bundles pay off through average
      order value and conversion, not through amortizing a fee that was never paid eight times

## 1. Ticket A — schema, kernel, allocation, photographer configuration (ships dark)

- [ ] 1.1 Migration: additive nullable `events.bundle_tiers jsonb`; no constraint (the rules are app-level, per
      design D14). ⚠️ Apply to prod by hand via MCP after merge — `migrate.yml` is blocked on Actions billing
- [ ] 1.2 New client-safe `src/lib/bundle-pricing.ts`: `getBundlePriceCents(quantity, unitPriceCents, tiers)` as
      `min(quantity × unit, cheapest applicable tier total)`, the disable constant, and a `parseBundleTiers`
      that fails closed to "no tiers" on anything it cannot validate
- [ ] 1.3 Allocation kernel in the same module: largest-remainder split of a total across N photos with
      `sum(allocated) === total` exactly and deterministic ordering
- [ ] 1.4 Validation predicate (`isValidBundleSchedule`): thresholds integer ≥ 2, strictly increasing, no
      duplicates; totals positive integers ≥ `MIN_PHOTO_PRICE_CENTS`; every total strictly below
      `minQuantity × price_per_photo`; tier count capped
- [ ] 1.5 Query layer: read/write `bundle_tiers` in `src/database/queries/events.ts`, migration-gated on write
      the way `session_end_time` / `organizer_fee_per_photo_cents` are
- [ ] 1.6 Event create + edit actions: `superRefine` on the schedule; reject on `organizer` events; reject when
      the event is free (`price_per_photo` null/0); rejection travels as a parseable sentinel like
      `MIN_PHOTO_PRICE:<cents>` and is localized client-side
- [ ] 1.7 Event create wizard + edit form: bundle-tier fields (hidden for organizer and free events), showing
      the effective per-photo price at each threshold as the photographer types; strings in `en.json` + `es.json`
- [ ] 1.8 Unit tests: kernel (tier selection picks the cheapest applicable, below-threshold undiscounted,
      misconfigured tier can never exceed singles, disable constant), allocation (sums exactly, indivisible
      totals, determinism), `parseBundleTiers` fail-closed, validation (each rule, and the floor at the tier
      total not per photo)
- [ ] 1.9 Integration tests against local Supabase: both event actions persist and clear a schedule, reject
      below-floor / non-discount / organizer / free-event schedules without creating or mutating a row, and
      leave existing rows untouched
- [ ] 1.10 Verify dark: with tiers configured, no cart, checkout session, order row or payout differs from
      today

## 2. Ticket B — buyer-facing pricing, both checkouts, webhook (the deploy where money changes)

- [ ] 2.1 Migration: additive nullable `cart_items.allocated_price_cents`. ⚠️ Same manual prod step as 1.1
- [ ] 2.2 Group the validated cart by `(event, photographer)` and price each group through
      `getBundlePriceCents`; groups without an applicable tier keep list prices
- [ ] 2.3 Guest checkout (`src/app/[lang]/cart/actions.ts`): line items built from the allocated amounts;
      allocated cents written into the existing `cart_<i>` metadata `c` field (no new mechanism); service fee
      from `getBuyerServiceFeeCents` of the **post-discount** subtotal
- [ ] 2.4 Authenticated checkout (`src/app/[lang]/dashboard/talent/cart/actions.ts`): same pricing and line
      items; allocation persisted to `cart_items.allocated_price_cents` before the session is created
- [ ] 2.5 Webhook: prefer `allocated_price_cents` (authenticated) / the metadata `c` (guest) when building
      `order_items` / `guest_order_items`; fall back to `unit_price_cents` when absent; **never** recompute a
      bundle price from the event's tiers
- [ ] 2.6 `src/components/cart-totals.tsx`: subtotal → bundle discount → service fee → total, rendering exactly
      today's single subtotal row when no discount applies; wired at all four render sites; strings in
      `en.json` + `es.json`
- [ ] 2.7 Next-tier prompt in the cart, computed from the same kernel, stating the resulting total and hidden
      when no further tier exists
- [ ] 2.8 Confirm already-owned photos stay excluded from the cart and do not count toward a threshold
- [ ] 2.9 Integration tests, both flows: charged total equals `getBundlePriceCents`; allocation sums exactly to
      it; exactly one service-fee line item, computed on the discounted subtotal; a client-supplied price is
      ignored; a cart spanning two events discounts only the qualifying group; a session with no allocation
      produces today's order unchanged
- [ ] 2.10 Integration test: the photographer transfer for a bundled order equals
      `getPhotographerNetCents(bundleTotal, plan)` and never the list-price total
- [ ] 2.11 Test that editing tiers between session creation and webhook delivery does not change the resulting
      order
- [ ] 2.12 Regression test that a reveal-gated event exposes no bundle affordance and no unrevealed photo ids
- [ ] 2.13 `pnpm build` in addition to typecheck/lint/test — `bundle-pricing.ts` is imported by client
      components, and only a build catches a server-only leak into the client graph

## 3. Ticket C — photographer-facing truth (earnings and sales)

- [ ] 3.1 Earnings and Sales report the discounted gross for a bundled sale, with commission still derived as
      `gross − getPhotographerNetCents(gross)` so `gross = commission + net` holds (the T-197 invariant)
- [ ] 3.2 Copy on both tabs explaining that a bundle discount is the photographer's own price reduction — not a
      platform deduction and not related to the buyer service fee; strings in `en.json` + `es.json`
- [ ] 3.3 Tests: a bundled sale shows the same gross/commission/net in both tabs; the sum over a mixed period of
      bundled and single sales matches the payouts actually transferred

## 4. Rollout (OWNER gate)

- [ ] 4.1 Enable a schedule on one real event and complete one real bundled purchase; verify cart total, Stripe
      receipt, order rows, transfer amount and the earnings row all agree
- [ ] 4.2 Only then surface the feature to photographers generally

## 5. Follow-ups (out of scope — capture separately when wanted)

- [ ] 5.1 "Add all my face matches to cart" — must derive ids from the reveal-gate proven set
      (`getProvenRevealIds`), never from a fresh server-side query
- [ ] 5.2 Organizer-event bundles — blocked on organizer revenue sharing existing at all
      (`organizer_fee_per_photo_cents` is currently written and never read)
- [ ] 5.3 Retroactive credit for photos already bought — needs a refund/credit mechanism this system lacks
