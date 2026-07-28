## Why

Today the platform's only per-sale revenue is the seller commission (12/8/5%), which is **percent-only**. Stripe's fee is **fixed + percent** (EU base ≈ €0.25 + 1.5%), so on a small sale the commission can't cover the fixed €0.25 and the platform **loses money** (break-even is ~€2.50–3.00/photo). The owner wants fees as low as possible for buyers and photographers — down toward break-even — but **never at a loss**. The fix is to make the fee structure mirror the cost structure: introduce a **fixed component**, put it on the buyer, and lower seller commissions to clean margin. Full narrative and competitor/legal research: `docs/BILLING_MODEL.md`.

## What Changes

- **Buyer service fee** — a new fee on the buyer at checkout: **fixed + percent of subtotal**. The fixed part structurally covers Stripe's fixed cost. Shown as its own visible line item, with the total disclosed **up front** (PSD2: a flat uniform service fee is lawful; the Vinted enforcement was about *disclosure*, not the fee).
- **Fee is ENV-configurable** (`BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS`) — the exact numbers are set after measuring the real Stripe fee distribution, without a code change. Provisional: **€0.30 + 1.5%**, min **€1.50**.
- **Seller commissions lowered to Free 8% / Starter 4% / Pro 0%**, now clean margin (Stripe no longer eaten by it). **BREAKING** revenue-model change vs the current 12/8/5%.
- **Starter repriced to €9.99/mo** (€95.88/yr) so each tier owns a real GMV band (Free <€250 · Starter €250–500 · Pro >€500/mo) — otherwise Starter is economically dominated with Pro at 0%.
- **Minimum photo price** enforced at event create/edit so the fee is never disproportionate on a trivially cheap photo.
- **Single calc point** — add `getBuyerServiceFeeCents` beside `getPhotographerNetCents` in `src/lib/plans.ts`; the fee is never re-derived anywhere else.
- Currency is already EUR (shipped in T-193) — prerequisite, not part of this change.
- **Out of scope (follow-up):** bundles / "buy all my photos" volume pricing; multi-currency; the ledger (T-190).

## Capabilities

### New Capabilities
- `buyer-service-fee`: the buyer-facing service fee (fixed + percent, env-configurable), its single server-side calc point, its addition as a separate visible Stripe line item in both checkout flows with up-front total disclosure, the cart/checkout/earnings display of it, and the coupled seller-commission reduction (8/4/0) + Starter reprice that this fee makes possible.
- `minimum-photo-price`: an env-configurable floor on `events.price_per_photo`, enforced at event create and edit, so the fixed fee is never disproportionate to the item.

### Modified Capabilities
<!-- None. Commission rates and subscription prices live in src/lib/plans.ts / env, not as OpenSpec spec requirements; the routing spec (plan-subscription-intent) is unaffected. -->

## Impact

- **Code:** `src/lib/plans.ts` (new `getBuyerServiceFeeCents` + min-price constant + reduced `PLATFORM_FEE_RATES`); `env.mjs` (3 new vars); both checkouts (`src/app/[lang]/cart/actions.ts` guest, `src/app/[lang]/dashboard/talent/cart/actions.ts` authed) — fee line item + total; cart/checkout display; photographer earnings breakdown; event create/edit price validation; i18n (`en.json`/`es.json`).
- **Revenue model:** changes what buyers pay and what photographers net — a real economic change, so every implementation PR requires `/code-review ultra`.
- **Gates that stay with the owner:** (1) **measure** the real Stripe fee distribution (dashboard) and set the env values to the **worst realistic** case before enabling — especially because Pro 0% means the buyer fee is the only thing covering Stripe on a Pro sale; (2) **approve this design** before implementation child tickets are opened.
