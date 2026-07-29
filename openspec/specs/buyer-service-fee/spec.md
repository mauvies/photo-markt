# buyer-service-fee Specification

## Purpose

Make the platform's fee structure mirror its cost structure. Stripe charges fixed + percent, so a percent-only seller commission cannot cover the fixed part on a small sale and those sales are made at a loss. A buyer-facing service fee of **fixed + percent**, charged as its own visible Stripe line item with the total disclosed up front, supplies the fixed component — which in turn makes the reduced seller commissions (Free 8% / Starter 4% / Pro 0%) affordable. The configured amounts are named constants in `src/lib/plans.ts` shipping at 0, so the capability lands dark and is switched on by a reviewable one-line change.

## Requirements

### Requirement: Service fee is computed in a single place as fixed + percent

The buyer service fee MUST be computed by exactly one function, `getBuyerServiceFeeCents(subtotalCents)` in `src/lib/plans.ts`, as `BUYER_SERVICE_FEE_FIXED_CENTS + round(subtotalCents × BUYER_SERVICE_FEE_BPS / 10000)`. The three values (`BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, and the minimum-price constant) MUST be declared in exactly one place in `src/lib/plans.ts` and MUST NOT be duplicated or re-stated at call sites. No checkout, cart, or earnings code path MAY re-derive the fee inline.

They are **named constants, not environment variables** (amended during T-195, superseding the original env-var decision in `design.md` D2). These amounts determine what every buyer is charged, so a reviewable diff and a revertible commit are worth more than the ability to change them without a deploy — which on Vercel needs a redeploy anyway. Constants also keep the values out of silent staging/prod drift, put a human between a typo and every buyer's card, and keep `plans.ts` free of server-only env access so the cart can display the fee from the same function that charges it.

#### Scenario: Fee combines the fixed and percent components
- **WHEN** `getBuyerServiceFeeCents` is called for a €10.00 (1000-cent) subtotal with `FIXED=30`, `BPS=150`
- **THEN** it returns 45 cents (30 fixed + 15 percent), computed once and reused for both the charge and the display

#### Scenario: Fee rounds deterministically
- **WHEN** the percent component is fractional (e.g. subtotal 199 cents at 150 bps = 2.985)
- **THEN** the function rounds to a whole number of cents by a single defined rule, so the charged and displayed fee are always the same integer

### Requirement: The fee is charged as a separate, visible Stripe line item

Both checkout flows — guest (`src/app/[lang]/cart/actions.ts`) and authenticated (`src/app/[lang]/dashboard/talent/cart/actions.ts`) — MUST add the service fee as its own Stripe `line_item` (not folded into a photo's price), so the buyer's receipt itemizes it. The line item's amount MUST equal `getBuyerServiceFeeCents` of the validated cart subtotal.

#### Scenario: Checkout session itemizes the fee
- **WHEN** a cart with a €4.00 subtotal is checked out
- **THEN** the created Stripe session contains the photo line item(s) plus one distinct "service fee" line item whose amount equals `getBuyerServiceFeeCents(400)`, and the session total is subtotal + fee

#### Scenario: Charged fee equals the single calc point
- **WHEN** the checkout builds the fee line item
- **THEN** its amount is taken from `getBuyerServiceFeeCents` (never recomputed), so it can never diverge from what the cart displayed

### Requirement: The total including the fee is disclosed up front

The cart and checkout UI MUST show the fee as its own line and the total as `subtotal + service fee` **before** the final checkout step — never revealing the fee only at the last moment. Disclosure is the legal requirement (a flat uniform service fee is lawful under PSD2; the risk is surprise pricing).

#### Scenario: Cart shows the fee line and full total
- **WHEN** a buyer views a non-empty cart
- **THEN** the summary shows the subtotal, a labeled service-fee line, and a total equal to their sum, all before proceeding to Stripe

### Requirement: The fee is disable-able via configuration

`BUYER_SERVICE_FEE_FIXED_CENTS = 0` and `BUYER_SERVICE_FEE_BPS = 0` MUST reproduce the pre-v2 buyer-facing behavior: no fee line item is added and no fee line is displayed. This is the kill-switch, and it is the value the constants ship at — the feature lands dark and is switched on by a one-line change to `plans.ts`, with rollback being a revert of that commit.

#### Scenario: Zero configuration adds no fee
- **WHEN** both fee constants are 0
- **THEN** `getBuyerServiceFeeCents` returns 0, no service-fee line item is added to the Stripe session, and the cart shows no fee line (total equals subtotal)

### Requirement: Seller commission is reduced to clean margin

Because the buyer service fee now covers Stripe's cost, seller commission rates MUST be reduced to Free 8% / Starter 4% / Pro 0% in `PLATFORM_FEE_RATES` (`src/lib/plans.ts`), and the advertised "% sales fee" MUST stay derived from that single source (no divergence between marketing copy and applied fee). The photographer's net payout formula (`price × (1 − commission)`) is unchanged in shape; only the rates change.

#### Scenario: Commission rates match the reduced tiers
- **WHEN** `getPhotographerNetCents` is called for a €10.00 sale on each tier
- **THEN** Free nets €9.20 (8%), Starter €9.60 (4%), Pro €10.00 (0%), and the pricing UI advertises the same percentages

### Requirement: Earnings breakdown treats the fee as platform revenue

The photographer's earnings/sales view MUST NOT present the buyer service fee as money the photographer receives or pays. The breakdown shows the photographer's net (`price × (1 − commission)`); the service fee is platform revenue and is excluded from the photographer's cut.

#### Scenario: Photographer breakdown excludes the buyer fee
- **WHEN** a €10.00 Pro-tier sale (0% commission, buyer paid a €0.45 fee on top) is shown in earnings
- **THEN** the photographer's net reads €10.00 and the €0.45 buyer fee is not added to or subtracted from their figure
