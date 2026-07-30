<!--
Each numbered group below maps to one implementation child ticket, in executable
order. Capture each with /ticket after the owner approves this design (group 0).
Every implementation PR touches payments → /code-review ultra is mandatory.
Groups 0 and 4 are OWNER gates, not code.
-->

## 0. Design gate (OWNER — not code)

- [x] 0.1 Owner approves this design in the PR before any child ticket below is opened — **approved
      2026-07-29**, PR #263 merged; children opened as **T-203 (A) → T-204 (B) → T-205 (C)**
- [x] 0.2 Owner confirms they still want bundles knowing the economic premise was corrected — the buyer
      service fee is charged **once per checkout**, not once per photo, so bundles pay off through average
      order value and conversion, not through amortizing a fee that was never paid eight times —
      **confirmed with the approval above**

## 1. Ticket A — schema, kernel, allocation, photographer configuration (ships dark)

- [x] 1.1 Migration: additive nullable `events.bundle_tiers jsonb`; no constraint (the rules are app-level, per
      design D14). ⚠️ Apply to prod by hand via MCP after merge — `migrate.yml` is blocked on Actions billing
- [x] 1.2 New client-safe `src/lib/bundle-pricing.ts`: `getBundlePriceCents(quantity, unitPriceCents, tiers)`
      selecting the rung with the **greatest** `minQuantity ≤ quantity` then taking
      `min(quantity × unit, rungTotal)` — never the cheapest applicable rung, which would shadow every rung
      above it; plus the disable constant and a `parseBundleTiers` that fails closed to "no tiers" on anything
      it cannot validate
- [x] 1.3 Allocation kernel in the same module: largest-remainder split of a total across N photos with
      `sum(allocated) === total` exactly and deterministic ordering
- [x] 1.4 Validation predicate (`isValidBundleSchedule`): thresholds integer ≥ 2, strictly increasing, no
      duplicates; totals positive integers ≥ `MIN_PHOTO_PRICE_CENTS`; **totals strictly increasing with
      threshold** (without this the ladder collapses to one rung); every total strictly below
      `minQuantity × price_per_photo`; rung count capped
- [x] 1.5 Query layer: read/write `bundle_tiers` in `src/database/queries/events.ts`, migration-gated on write
      the way `session_end_time` / `organizer_fee_per_photo_cents` are
- [x] 1.6 Event create + edit actions: `superRefine` on the schedule; reject on `organizer` events; reject when
      the event is free (`price_per_photo` null/0); rejection travels as a parseable sentinel like
      `MIN_PHOTO_PRICE:<cents>` and is localized client-side
- [x] 1.7 Ladder editor in the **create wizard** (`events/new/steps/step-3-details.tsx`, beside the price field,
      plus `wizard-storage.ts` / `wizard-types.ts` / `wizard.schema.ts`) — add, reorder and remove rungs; hidden
      for organizer and free events; shows the effective per-photo price at each threshold as the photographer
      types; strings in `en.json` + `es.json`
- [x] 1.8 Wizard **review step** (`step-5-review.tsx`) shows every rung — nobody confirms a price they were
      never shown
- [x] 1.9 **New `Pricing` top-level tab** on the photographer's event detail page
      (`dashboard/photographer/events/[id]/page.tsx`), positioned between `Details` and `Share`:
      - `EventTab` (`event-tab.ts`) extends to `'photos' | 'details' | 'pricing' | 'share'`; `parseEventTab` and
        `EventTabs` (`event-tabs.tsx`) add the fourth trigger + content pair in that order
      - the tab shows the unit price and the ladder read-only (threshold → total → effective per-photo price),
        plus an **Edit pricing** link
      - **new scoped edit section**, mirroring the existing `info`/`settings` pattern (T-179): `ScopedSection`
        (`edit/scoped-event-edit-form.tsx`) becomes `'info' | 'settings' | 'pricing'`; `parseSection`
        (`edit/page.tsx`) accepts `'pricing'`; `?section=pricing` renders just the ladder editor — `/edit`
        remains the only surface that writes a field, same as `info`/`settings` today
      - strings in `en.json` + `es.json` (`tabPricing`, edit-section title/subtitle)
- [x] 1.10 **New shared `src/components/event-pricing-section.tsx`** (a `Card`-based panel, matching the visual
      language of other event cards): shows the unit price and, when the event has a ladder, the ladder table;
      renders exactly the unit price alone when there is no ladder. Mounted at the same position — directly
      under `EventMetaLine`, above the gallery/contribute affordances — on **both**
      `events/[shareCode]/page.tsx` (public) and `dashboard/talent/events/[id]/page.tsx` (talent dashboard), so
      the two views cannot disagree about the same event's price
- [x] 1.11 Unit tests: kernel (three-rung ladder charges each rung and the 8+ rung is not shadowed by a cheaper
      3+ rung; below-threshold undiscounted; price non-decreasing in quantity across every valid schedule;
      misconfigured rung can never exceed singles; disable constant), allocation (sums exactly, indivisible
      totals, determinism), `parseBundleTiers` fail-closed, validation (each rule, the non-increasing-totals
      rejection, and the floor applied to the rung total not per photo), `parseEventTab`/`parseSection` accept
      the new values
- [x] 1.12 Integration tests against local Supabase: both event actions persist and clear a schedule, reject
      below-floor / non-increasing / non-discount / organizer / free-event schedules without creating or
      mutating a row, and leave existing rows untouched
- [x] 1.13 Verify dark: with a ladder configured, no cart, checkout session, order row or payout differs from
      today (the four surfaces above are the only visible change, and they are read-only until ticket B)

## 2. Ticket B — buyer-facing pricing, both checkouts, webhook (the deploy where money changes)

- [x] 2.1 Migration: additive nullable `cart_items.allocated_price_cents`. ⚠️ Same manual prod step as 1.1
- [x] 2.2 Group the validated cart by `(event, photographer)` and price each group through
      `getBundlePriceCents`; groups without an applicable tier keep list prices
- [x] 2.3 Guest checkout (`src/app/[lang]/cart/actions.ts`): line items built from the allocated amounts;
      allocated cents written into the existing `cart_<i>` metadata `c` field (no new mechanism); service fee
      from `getBuyerServiceFeeCents` of the **post-discount** subtotal
- [x] 2.4 Authenticated checkout (`src/app/[lang]/dashboard/talent/cart/actions.ts`): same pricing and line
      items; allocation persisted to `cart_items.allocated_price_cents` before the session is created
- [x] 2.5 Webhook: prefer `allocated_price_cents` (authenticated) / the metadata `c` (guest) when building
      `order_items` / `guest_order_items`; fall back to `unit_price_cents` when absent; **never** recompute a
      bundle price from the event's tiers
- [x] 2.6 `src/components/cart-totals.tsx`: subtotal → bundle discount → service fee → total, rendering exactly
      today's single subtotal row when no discount applies; wired at all four render sites; strings in
      `en.json` + `es.json`
- [x] 2.7 Next-rung prompt in the cart, computed from the same kernel, stating the resulting total and hidden
      when no further rung exists
- [x] 2.8 Confirm already-owned photos stay excluded from the cart and do not count toward a threshold
- [x] 2.9 **Remaining buyer-facing ladder display** (the dedicated pricing section on both event views already
      shipped dark in 1.10): `src/components/event-meta-line.tsx` in compact form (it feeds event cards and both
      event pages' header line — separate from the section in 1.10, which carries the full table);
      `events/[shareCode]/page.tsx`'s schema.org `offers` JSON-LD, which currently emits a single unit-price
      offer and must describe the ladder; `src/components/photo-detail-modal.tsx` and
      `src/components/photo-album-viewer.tsx` (the price sits right above add-to-cart — highest-intent moment);
      strings in `en.json` + `es.json`
- [x] 2.10 `src/components/photo-selection-toolbar.tsx`: with N photos selected, show the running bundle price
      and the next rung
- [x] 2.11 **"Add all my photos" after a face search**, on both the public event page and the talent-dashboard
      event view, reusing the existing multi-select + `handleBulkAddToCart` plumbing. Ids come from what the
      buyer already holds — the client's match set on a non-gated event, `getProvenRevealIds` on a gated one —
      **never** a fresh server-side query for the event's photos
- [x] 2.12 Check the paid-amount surfaces still read correctly now that amounts are allocated rather than list
      prices: talent orders history, guest success page, guest purchase email
- [x] 2.13 Integration tests, both flows: charged total equals `getBundlePriceCents`; allocation sums exactly to
      it; exactly one service-fee line item, computed on the discounted subtotal; a client-supplied price is
      ignored; a cart spanning two events discounts only the qualifying group; a session with no allocation
      produces today's order unchanged
- [x] 2.14 Integration test: the photographer transfer for a bundled order equals
      `getPhotographerNetCents(bundleTotal, plan)` and never the list-price total
- [x] 2.15 Test that editing the ladder between session creation and webhook delivery does not change the
      resulting order
- [x] 2.16 Regression test that a reveal-gated event exposes no bundle affordance and no unrevealed photo ids,
      and that "add all my photos" on a gated event adds only ids in the proven reveal set
- [x] 2.17 `pnpm build` in addition to typecheck/lint/test — `bundle-pricing.ts` is imported by client
      components, and only a build catches a server-only leak into the client graph

### Corrections found while executing group 2 (T-204)

- **2.9's premise about event cards was wrong, and its prescription for the meta line was backwards.**
  The design said `event-meta-line.tsx` "feeds event cards", so a card would quote a misleading unit
  price. It does not: `EventMetaLine` is used only by the three event *detail* pages, and
  `event-card.tsx` renders **no price at all**. And on those detail pages the fix is not to *add* a
  compact ladder segment next to the unit price (shipped first, then removed on owner feedback) but to
  **remove the price segment altogether** once a schedule exists: `EventPricingSection` sits directly
  below and already states the unit price and every package, so the segment was pure duplication — and
  on an event sold by the package, the unit price is the least relevant number to lead with. The rule
  is now "exactly one surface quotes the price": the section when there is a schedule, the meta line
  when there isn't. The one-line offer formatter is still used by the purchase modal and the selection
  toolbar, which are overlays where the section is not visible.
- **1.10's pricing section never displayed `bundle_all_photos_cents`.** Ticket A made the "all photos"
  ceiling *writable* (both event actions validate and persist it) but `EventPricingSection` only rendered
  rungs — so a photographer could configure a Foto-Flat that no buyer was ever shown, which is exactly the
  wrong-price class 2.9 exists to close. The ceiling is now a row in that table, on both surfaces.
- **The allocation is committed only for DISCOUNTED groups.** Writing the list price into
  `allocated_price_cents` for undiscounted items would produce identical orders but blur what the column
  means; null has to keep saying "no bundle applied" so an unbundled cart provably takes the pre-bundle
  path (`discountedAllocations`, asserted by test).

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

- [ ] 5.1 Organizer-event bundles — blocked on organizer revenue sharing existing at all
      (`organizer_fee_per_photo_cents` is currently written and never read)
- [ ] 5.2 Retroactive credit for photos already bought — needs a refund/credit mechanism this system lacks
