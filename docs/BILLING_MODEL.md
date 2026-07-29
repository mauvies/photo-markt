# Photo Markt — Billing Model

> Status: **v2 has shipped its structure** (T-195 config + calc point, T-196 buyer fee line item and
> the 8/4/0 commissions). The buyer fee **amounts** are still 0 pending a measurement of the real
> Stripe fee distribution — turning them on is a one-line change to the constants in
> `src/lib/plans.ts`. The v1 sections below are kept as the record of the analysis, not as a
> description of current behaviour. Single source of truth for commission math: `src/lib/plans.ts`
> (`getPhotographerNetCents`, `PLATFORM_FEE_RATES`, `getBuyerServiceFeeCents`).

## The core principle

**A fee structure must mirror the cost structure.** Stripe charges **fixed + percent**
(EU base ≈ **€0.25 + 1.5%**, higher for cross-border cards and currency conversion). v1's only
per-sale revenue — the seller commission — is **percent-only, with no fixed component**, so on a
small sale the percent can't cover Stripe's fixed €0.25 and the platform loses money. v2 fixes this by
introducing a fixed component into the fees.

---

## v1 — Superseded model (historical; replaced by v2 in T-195/T-196)

| Plan | Subscription | Seller commission | Buyer fee | Who absorbs Stripe fee | Min photo price |
|---|---|---|---|---|---|
| Free | — | **12%** | none | **Platform** | none |
| Starter | $14.99/mo ($143.88/yr) | **8%** | none | **Platform** | none |
| Pro | $29.99/mo ($287.88/yr) | **5%** | none | **Platform** | none |

- **Currency: USD** (hardcoded — see the bug below). Photographer sets `price_per_photo` with no
  currency; checkout charges it as USD.
- Photographer receives `price × (1 − commission)`. Platform absorbs both the Stripe processing fee
  **and** the 0.5% Connect transfer fee (per CLAUDE.md), so the photographer always nets their
  promised amount.

### Why v1 loses money on small sales

Worked example — a €0.99 photo, Free plan:

| Line | Amount |
|---|---|
| Buyer pays | €0.99 |
| − Stripe fee (≈1.5% + €0.25, **plus ~2% currency conversion** — see bug) | ≈ −€0.29 |
| − Photographer payout (0.99 × 0.88) | −€0.87 |
| **Platform result** | **≈ −€0.17 (loss)** |

The 12% commission (€0.12) cannot cover Stripe's fixed €0.25. Break-even under v1 is roughly a
**€2.50–3.00** photo; anything cheaper is sold at a loss.

### 🐞 Currency bug (T-193)

Checkout hardcodes `currency: 'usd'` (`cart/actions.ts:194` guest, `dashboard/talent/cart/actions.ts:428`
authenticated; `orders`/`guest-orders` default `'usd'`; dashboard formatters `'USD'`; plan prices
commented "USD"). But the platform's Stripe account settles in **EUR** (`default_currency: eur`), and
the business + users are in the EU. So every sale is charged in USD to a Spanish buyer and then
**converted to EUR on settlement**, adding a **~2% currency-conversion fee** on top of the base Stripe
fee — making the small-sale loss worse. This must be fixed to EUR before/with v2.

---

## v2 — Proposed model (design in T-194)

Goal stated by the owner: **be as cheap as possible for buyers and photographers — sacrifice
per-sale platform profit down toward break-even, but never take a loss.** Achieved by giving the fee a
fixed component (put on the buyer) that covers Stripe's fixed cost, keeping the commission as a thin
tier margin, and moving profit weight onto subscriptions.

| Plan | Subscription | Seller commission (margin) | Buyer service fee | Who absorbs Stripe fee | Min photo price |
|---|---|---|---|---|---|
| Free | — | **8%** | **€0.30 + 1.5%** of subtotal | Buyer (via the service fee) | **€1.50** |
| Starter | **€9.99/mo** (€95.88/yr) | **4%** | €0.30 + 1.5% | Buyer | €1.50 |
| Pro | €29.99/mo (€287.88/yr) | **0%** — "keep 100%" | €0.30 + 1.5% | Buyer | €1.50 |

> **Buyer-fee and min-price numbers are provisional.** The buyer-fee fixed part (€0.30), its percent
> (1.5%), and the minimum price (€1.50) must be finalized against the **measured** Stripe fee
> distribution for the real card/currency mix (T-194 task). The fixed part must cover the **worst
> realistic** Stripe fee (a non-EEA card is ~3.25% + €0.25; note EUR settlement removes the ~2%
> conversion fee) plus the ~0.5% Connect transfer fee, not the cheapest case — **especially because Pro
> is 0% commission**, so the buyer fee is the only thing covering Stripe on a Pro sale.
> **Subscription prices and commissions are decided** (owner): 8 / 4 / 0%, Starter repriced to €9.99.

Key changes vs v1:

1. **Currency → EUR** everywhere (fixes T-193, removes the ~2% conversion fee).
2. **Buyer service fee** with a **fixed** component — the piece that structurally covers Stripe's
   fixed cost. Legal in the EU: a flat platform/service fee applied uniformly regardless of payment
   method is **not** a PSD2 surcharge (confirmed in the competitor research; Vinted, Bookwhen,
   Eventbrite, surfcloud all do buyer-side fees lawfully).
3. **Seller commission lowered to 8 / 4 / 0%** and now **clean margin** — no longer eaten by Stripe;
   the saving from moving Stripe onto the buyer is passed to the photographer.
4. **Minimum photo price** so the fee is never disproportionate on a trivially cheap photo, and to
   nudge toward bundles.
5. **Profit weight shifts to subscriptions.** Per-sale margin is intentionally thin; the SaaS tiers
   are where the platform makes money. Free tier ≈ break-even + small buffer (an acquisition
   loss-leader).

### Worked examples (provisional numbers, EUR)

**A — single photo €2.00, Free plan (12%):**

| Line | Amount |
|---|---|
| Buyer pays (2.00 + 0.30 + 1.5%) | €2.33 |
| − Stripe fee (EUR, ≈1.5% + €0.25) | ≈ −€0.29 |
| − Photographer (2.00 × 0.88) | −€1.76 |
| **Platform result** | **≈ +€0.28** |

**B — €12 bundle, Pro plan (5%):**

| Line | Amount |
|---|---|
| Buyer pays (12.00 + 0.30 + 1.5%) | €12.48 |
| − Stripe fee (≈1.5% + €0.25) | ≈ −€0.44 |
| − Photographer (12.00 × 0.95) | −€11.40 |
| **Platform result** | **≈ +€0.64** |

Both positive — **no loss on any sale**, while the buyer fee stays small in absolute terms.

### Currency policy

**Charge everyone in the platform's settlement currency (EUR), for now.** The rule that decides this:
presenting a currency ≠ the settlement currency makes Stripe charge a **~2% conversion fee** — the exact
fee v2 is trying to remove.

- **EU buyer** → sees EUR, no conversion.
- **Non-EU buyer** → still charged in EUR; **their own bank** converts to local currency at the buyer's
  cost — invisible to the platform's economics. The platform absorbs no FX.
- Photographer sets **one price in EUR**; that is what everyone pays. No per-currency price tables.
- **Adaptive Pricing: OFF.** It presents the buyer's local currency and makes Stripe do the FX → the
  platform eats the conversion fee. (With v1's USD base, Adaptive is what produced the USD charge to a
  Spanish buyer.) Base EUR + Adaptive OFF = zero FX on the platform side.

**Conditioning currency on country (multi-currency)** is deliberately **deferred** — each non-EUR
presentment currency either costs the platform ~2% FX (defeating the goal) or requires holding multiple
settlement balances (multiple balances + FX on bank payout + per-currency pricing). It is a
growth-stage optimization, worth it only with real non-EU volume and a willingness to trade FX for
better local-currency conversion. Not now.

### Who gets the "Stripe saving" — lowering the commission

In v1 the commission (12/8/5%) covered **two** things: the platform margin **and** the Stripe fee the
platform absorbed. In v2 the buyer service fee covers Stripe, so the commission is now **over-loaded**
with a cost it no longer carries. That freed cost can go to the **platform** (keep 12/8/5 → higher net
than v1), the **photographer** (lower the commission → they keep more), or a split.

Given the strategy (cheap/attractive; photographer supply is the scarce side early on), the recommended
direction is to **lower the commission** — pass the saving to the photographer. Two guardrails:

1. **Keep a meaningful tier spread.** The only reason to upgrade to Pro is a lower commission
   (12 → 5). Flattening the spread kills the subscription-upgrade funnel.
2. **Don't zero the Free-tier commission** unless subscriptions can carry all profit — a 0% Free
   photographer generates almost nothing per sale.

**Chosen commissions (owner decision): Free 8% / Starter 4% / Pro 0%.** Rationale: Pro already pays a
high subscription, so it earns a clean "keep 100% of every sale" value prop. Strong marketing hook and a
clear upgrade funnel.

Two caveats this choice introduces (both to validate in T-194 with real fee data):

1. **Pro 0% removes the commission cushion.** On a Pro sale the buyer service fee is the *only* thing
   covering Stripe. If Stripe's fee spikes (non-EEA card ~3.25%, plus the ~0.5% Connect transfer fee the
   platform absorbs), a Pro sale can go slightly negative:

   > €1.50 photo, Pro 0%, expensive card: buyer €1.82 − Stripe ~€0.31 − photographer €1.50 − Connect fee
   > ≈ **−€0.02**.

   → With Pro at 0%, the **fixed** part of the buyer fee must cover the **worst-case** Stripe+Connect
   cost (raise it to ~€0.35–0.40), or the minimum price must be higher. Pro 0% is the tightest case and
   sizes the buyer fee.

2. **Tier funnel — resolved by repricing Starter to €9.99 (RESOLVED).** At the original Starter price
   (€14.99 @ 4%) Starter was economically *dominated*: with Pro at 0%, both the Free→Starter and
   Starter→Pro break-evens collapsed onto ~€375/mo GMV, so a rational photographer went Free (low
   volume) or Pro (high volume) and never picked Starter. **Fix applied:** Starter repriced to **€9.99
   @ 4%** (commission unchanged). Photographer monthly cost = subscription + commission × GMV:

   ```
   Free    = 0.08 · GMV
   Starter = 9.99 + 0.04 · GMV
   Pro     = 29.99
   Free < Starter   ⟺ GMV < €250/mo
   Starter < Pro    ⟺ GMV < €500/mo
   → Starter is cheapest in the €250–500/mo band
   ```

   Each tier now owns a real band — **Free < €250 · Starter €250–500 · Pro > €500/mo GMV**. Check:
   €150 → Free €12 wins; €300 → Starter €22 wins; €600 → Pro €30 wins. The dominance is gone without
   touching the chosen commissions. (Yearly Starter: €95.88 = 20% off, €7.99/mo equivalent, mirroring
   the existing yearly structure.)

There are now **three interacting knobs** — buyer service fee, commission, subscription price. T-194
must model them **together** against real fee data, not tune one in isolation. The Starter-dominance
math above is the clearest example of why one-knob-at-a-time fails.

### Optional lever — bundles ("buy all my photos")

Sports buyers want *all* their photos, not one. A bundle/volume discount raises average order value,
amortizes Stripe's fixed fee across more photos, and reads to the buyer as a deal. This is Sportograf's
entire model and is the highest-leverage addition for this vertical.

---

## Competitor reference (from the T-194 research)

| Platform | Who pays the fee | Structure |
|---|---|---|
| **surfcloud** | Buyer | Flat $3 + 5% of cart; photographer keeps 100% |
| **Sportograf** | Buyer | Bundle ("Foto-Flat") + ~6% buyer service fee |
| **GeoSnapShot** | Seller | Photographer 70% / platform 30%; seller also eats PayPal fee |
| **PhotoShelter** | Seller | Subscription ($12.99/29.99/49.99) + declining commission 10/9/8% — closest to Photo Markt's shape |
| **SmugMug** | Seller | Subscription + 15% of the markup |
| **Fotop / Fotto / Banlek** | Seller | Commission 8–15% / flat 10% / 9–10% |

**Nobody else absorbs the Stripe fee the way v1 does** — every competitor pushes it to either the
buyer or the seller. That is the single change v2 makes.

### Legal note (EU / PSD2)

The PSD2 surcharge ban (in force since 2018-01-13, EEA-wide) prohibits charging **extra for paying by
card**. It does **not** prohibit a flat marketplace **service fee** applied uniformly regardless of
payment method. v2's buyer service fee is the latter and is lawful, provided the total price
(including the fee) is shown clearly up front (the Vinted enforcement action was about *disclosure*,
not the fee's existence).
