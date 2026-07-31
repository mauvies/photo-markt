# CLAUDE.md

This file provides guidance to Claude Code when working with the Photo Markt codebase.

## Backlog workflow

The whole backlog/ticket flow lives in one place — `backlog/` (see [`backlog/README.md`](./backlog/README.md)).
Work is tracked in `backlog/BACKLOG.md` (priority-ordered); active tickets live under `backlog/tickets/`,
completed/discarded ones under `backlog/tickets/done/`, and the ticket template is `backlog/TEMPLATE.md`.
- `/ticket <req>` — capture a requirement as a ticket and file it priorized into the backlog (no code).
- `/work-next [T-ID]` — execute the top unblocked ticket end-to-end: branch → (OpenSpec if >1 file) → regression test → typecheck/lint/test → commit (Conventional Commits, **no `Co-Authored-By`**) → push → draft PR → archive ticket (move its file to `backlog/tickets/done/`).
- `scripts/run-backlog.sh [n]` — loop `/work-next` until no `todo` tickets remain.

One branch = one ticket = one draft PR.

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm lint         # Biome check (linting)
pnpm lint:fix     # Biome check with auto-fix
pnpm format       # Biome format with auto-fix
pnpm typecheck    # TypeScript type checking (no emit)
pnpm test         # Run all Vitest tests once (assumes local Supabase already up for integration)
pnpm test:unit    # Unit tests only (test/unit) — no Docker needed, fast
pnpm test:integration # supabase start → run test/integration → supabase stop (auto-managed)
pnpm test:watch   # Vitest watch mode
pnpm test:coverage # Vitest run + coverage report
pnpm db:start     # supabase start (Docker; local Supabase for integration tests)
pnpm db:stop      # supabase stop
pnpm db:reset     # supabase db reset (re-runs migrations + seed.sql)
pnpm db:seed      # Re-run supabase/seed.sql via psql
pnpm spell        # Spell check .ts/.tsx files
```

**`pnpm build` is not optional** when touching `src/lib/` or `src/database/queries/`: typecheck,
lint and test do not bundle, so only the build catches server-only code (e.g. `sharp`) pulled into
the client graph.

## Bash command style

To keep commands auto-approvable and avoid manual permission prompts:

- Prefer the native tools (Glob, Grep, Read) over shell `find` / `grep` / `cat` for locating files or searching code. They're faster and bypass shell approval checks entirely.
- This matters especially under `src/app/`, where Next.js dynamic route segments use square brackets (`[lang]`, `[code]`, `[id]`). Bracket characters in a `find` argument are glob characters and trigger mandatory manual approval that cannot be pre-approved.

When a shell command IS needed:

- Prefer simple, atomic commands. Run one operation per command instead of chaining multiple with `&&`.
- Do NOT use `cd` to change directories before running a command. Compound commands starting with `cd` plus output redirection require mandatory manual approval (path-resolution bypass protection) and cannot be pre-approved.
- Always use full paths from the repository root instead of `cd`-ing into a subdirectory.
- Run `git` commands from the repository root without `-C /abs/path` — the working directory is already the project root. `git -C ...` variants don't match the pre-approved `git status:*` / `git log:*` patterns and cause avoidable prompts.
- When inspecting multiple files, run separate individual commands rather than chaining them.
- Avoid unnecessary output redirection (`2>/dev/null`) and piping when a simpler single command achieves the same result.

## Project Overview

**Photo Markt** is a sports event photography marketplace connecting photographers with athletes (referred to as "talent"). Photographers create events, upload photos, and earn from sales. Talent browses events, finds photos of themselves, and purchases them.

## Tech Stack

- **Framework**: Next.js App Router, React 19, TypeScript
- **Database**: Supabase (PostgreSQL) — raw SQL migrations in `/supabase/migrations/`, no ORM
- **Auth**: Supabase Auth — Google OAuth only
- **Payments**: Stripe — subscriptions for photographers (Free/Starter/Pro), one-time purchases for talent, Stripe Connect for photographer payouts
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York style) + Radix UI
- **Forms**: TanStack React Form + Zod validation
- **Linting/Formatting**: Biome (not ESLint/Prettier)
- **Email**: Resend
- **AI matching**: AWS Rekognition (face indexing/search) — see AI Photo Search below
- **Background jobs**: Inngest (face indexing, thumbnail generation, storage cleanup, indexing-state reconciliation) served at `/api/inngest`
- **i18n**: Custom dictionary system (`/src/dictionaries/en.json`, `/src/dictionaries/es.json`)

## Architecture

### Routing

```
src/app/
  [lang]/               # i18n prefix — always /es/... or /en/...
    (home)/page.tsx     # Home page
    events/             # Public events listing and detail
    photographer/[slug] # Public photographer profiles
    cart/               # Guest and authenticated cart
    dashboard/
      photographer/     # Photographer dashboard (private)
      talent/           # Talent dashboard (private)
    login/
    signup/
    onboarding/
  auth/
    callback/           # Google OAuth callback — handles code exchange
  api/
    stripe/webhook/     # Stripe webhook (orders, transfers, subscriptions)
    billing/            # checkout/ + cancel/ — subscription Stripe sessions
    watermark/[...path] # Protected preview serving
    thumb/[...path]     # Baked thumbnail serving
    events/[id]/download # Purchased-photo ZIP
    inngest/            # Background-job worker — every function registered here
    admin/payouts/[id]  # Vestigial manual payout approval
    health/             # + health/ready (token-gated)
```

### Role-Based System

Two user roles with separate dashboards:
- **PHOTOGRAPHER** (`/dashboard/photographer`) — manages events, uploads/manages photos, tracks sales and earnings, manages payout account
- **TALENT** (`/dashboard/talent`) — browses events, finds and purchases photos of themselves, manages saved photos

Role is stored in `profiles.active_role`. Users can switch roles. Initial role assigned during onboarding via `src/app/[lang]/actions/roles.ts`.

### Key Architectural Patterns

**Server Actions for mutations**
All data mutations use `"use server"` actions in `actions.ts` files colocated next to their page components. Do not create new API routes for mutations — use server actions instead.
**Exception:** `api/admin/payouts/[id]` (admin, no page). ⚠️ `api/billing/{checkout,cancel}` are **dead
remnants** with zero callers — live billing is `dashboard/photographer/billing/actions.ts`; slated for
deletion (T-202), don't build on them.

**Database query layer**
All Supabase queries live in `/src/database/queries/`. Each domain has its own file. Always add new queries here — never inline in components or actions.

```
src/database/queries/
  events.ts           # Event CRUD and search
  photos.ts           # Photo management, sold-set + accessibility predicates
  profiles.ts         # User profiles
  orders.ts           # Purchase orders
  guest-orders.ts     # Guest checkout orders
  download-tokens.ts  # Guest download tokens
  carts.ts            # Cart management
  sales.ts            # Photographer sales data
  earnings.ts         # Photographer earnings
  photographers.ts    # Photographer-specific queries
  event-photographers.ts # Contributors + invitations (collaborative/organizer)
  event-covers.ts     # Cover / og:image signing chokepoints
  talent-library.ts   # Talent saved photos
  talent-photo-tags.ts # Talent "this is me" tags
  saved-events.ts     # Talent saved events
  subscriptions.ts    # Stripe subscription data
  payment-accounts.ts # LEGACY — superseded by Stripe Connect
  payouts.ts          # Payout requests
  storage.ts          # Supabase Storage helpers
  rekognition.ts      # photo_faces read/write
  bib-numbers.ts      # photo_bib_numbers read/write
  user-roles.ts       # Role context
  feedback.ts         # In-app feedback
  types.ts            # Shared client/error types
  index.ts            # Central export
```

**Supabase clients**
- Server-side (Server Components, Server Actions, API routes): `src/database/server.ts`
- Client-side (Client Components): `src/database/client.ts`
- Admin (service role, bypasses RLS): `src/database/supabase-admin.ts`

**Middleware**
`src/proxy.ts` — Next 16 renamed middleware to `proxy` (there is no `middleware.ts`). Refreshes Supabase auth sessions on every request and handles locale detection.

**i18n**
- Dictionaries: `/src/dictionaries/en.json` and `/src/dictionaries/es.json`
- Server-side: `src/lib/i18n/get-dictionary.ts`
- Client-side: `src/lib/i18n/translations-provider.tsx` + `useTranslations()` hook
- Always add new strings to both dictionaries. Never hardcode visible strings.

**Feature flags**
Controlled in `src/lib/feature-flags.ts`. `AI_MATCHING` is **enabled** — it powers face indexing (AWS Rekognition) and talent selfie search, run through Inngest background jobs. `searchFacesInEvent` re-checks the flag server-side, so keep both gates in sync.

**Environment validation**
`env.mjs` uses T3 Env (Zod). Always add new environment variables here.

## Database Schema

### Key Tables

**events**
`id, user_id, name, date, session_time, session_end_time, city, country, state, activity, is_public, share_code, slug, price_per_photo, bundle_tiers, bundle_all_photos_cents, watermark_enabled, reveal_gate_enabled, cover_path, is_collaborative, allow_guest_upload, require_upload_approval, type, organizer_fee_per_photo_cents, ai_matching_enabled, contains_minors, ai_matching_status, bib_detection_enabled, bib_detection_status, lat, lng, deleted_at, created_at, updated_at`
(canonical shape: the `Event` interface, `src/database/queries/events.ts:8`)
- Soft delete via `deleted_at`
- ⚠️ **`state` is the geographic region** (it pairs with `city`/`country`), NOT a status column.
  `upcoming`/`completed` is **derived from `date`** by `getEventStatus()` (`src/lib/event-status.ts:3`) — nothing is stored
- `start_date`, `end_date`, `time_offset`, `time_sync_enabled` exist in the DB but are **dead
  columns** — no application code reads or writes them (camera time-sync is off)
- `type` (`solo`/`collaborative`/`organizer`) + `require_upload_approval` decide whether uploads
  route through a Pending queue — one predicate, `eventUsesModerationQueue` (`src/lib/event-status.ts`).
  `organizer_fee_per_photo_cents` is written but read by **no** money path
- `session_time` (nullable `time`) is a **separate** concept — the manual session start time the photographer types, for display only; naive local time-of-day, not tied to `time_offset`/`time_sync_enabled` (T-106). `session_end_time` (nullable `time`, T-180) is its mirror — the manual session end; when both are set the UI shows a range ("09:30 – 12:00") via `formatSessionTimeRange`. App-level rule: an end requires a start and must be after it (`isValidSessionRange`); the column carries no constraint
- `share_code` allows access to private events
- **`bundle_tiers` (nullable `jsonb`, T-203) — volume pricing.** An optional **ladder** of rungs
  `[{minQuantity, totalPriceCents}]`, ascending; null = no bundle. **A bundle is a PRICE, not a PRODUCT:** the
  purchasable unit stays the photo and a sale still writes one `order_items` row per photo, so every
  entitlement reader (ZIP route, talent library, orders history, guest download token, sold-photo soft delete)
  is untouched — and a reveal-gated event has no whole-event product to unlock. Single calc point
  `getBundlePriceCents(quantity, unitCents, tiers)` in **`src/lib/bundle-pricing.ts`** (client-safe, so the cart
  displays what checkout charges): the applicable rung is the one with the **greatest** `minQuantity ≤ quantity`
  — **never the cheapest applicable rung**, which would shadow every rung above it and let a 20-photo buyer pay
  the 3-photo price — then `min(quantity × unit, rungTotal)`, which makes overcharging vs. singles structurally
  impossible. Validated at **write time** in both event actions (`validateBundleSchedule`), not by a DB
  constraint: thresholds integer ≥ 2 strictly increasing; totals positive, **strictly increasing with threshold**
  (without this the ladder collapses to one rung), each ≥ `MIN_PHOTO_PRICE_CENTS` applied to the **rung total**
  (not per photo — the floor governs what is being bought, and for a bundle that is the set) and strictly below
  `minQuantity × price_per_photo`. ⚠️ **The price is NOT monotonic in quantity, and nothing enforces that it
  is** (T-212 corrected an earlier claim here): a rung below `(minQuantity − 1) × unit` prices a smaller set
  higher — "3 for €9" at €5/photo charges €10 for two and €9 for three — and that is what a volume discount IS,
  since the flagship Foto-Flat shape ("40 for €19.90") drops from €195 to €19.90. Any rule strong enough to
  forbid the first forbids the second. The buyer is protected by the `min` against singles, not by monotonicity.
  **THREE submission states, not two (T-212):** `parseBundleTiersSubmission` / `parseAllPhotosSubmission` return
  `absent` (the form never carried the field ⇒ **don't touch the column**), `cleared` (explicitly emptied ⇒ write
  null), `invalid` (⇒ **reject the save and name the reason**; never write) or the parsed value. Collapsing these
  into one `null` was silent data loss on a money column: a cleared amount box, a `1` typed into a threshold, or
  a stored ladder the reader rejects each DELETED the photographer's pricing and reported success — and made
  `quantity_too_low` an unreachable message. `parseBundleTiers` (READ) still fails **closed** to "no ladder",
  which is right for a read (falling back to `quantity × unit` can only overcharge vs. intent — visible and
  refundable — never undercharge) and wrong for a write. **Only a form that renders the ladder editor may send
  it**: `buildEventUpdateFormData(parsed, { includeBundlePricing })` omits the field otherwise, so the scoped
  `info`/`settings` sections and the full `/edit` form stay silent. That is what stopped an unrelated save from
  wiping the ladder AND stopped lowering a price from throwing `total_not_a_discount` about a field the section
  cannot show. Excluded from **organizer** events (several possible sellers, and `organizer_fee_per_photo_cents`
  is written but read by no money path, so there is no revenue split to charge a discount against) and from free
  events — but an ineligible event **KEEPS its stored ladder** (T-212; it simply cannot apply, and restoring a
  price restores the packs). Write paths gate on **`eventAcceptsBundleConfig`**, never `eventSupportsBundles`:
  the latter folds in the kill switch, so flipping `BUNDLE_PRICING_ENABLED` for a rollback made the next save of
  any kind erase every stored ladder permanently — the exact opposite of the property the switch advertises.
  Pricing state must never block a save that isn't about pricing, and rollback must be inert: stored ladders
  survive it unread, so rollback needs no migration
- **Cart-level pricing (T-204) — `src/lib/cart-bundle-pricing.ts`, `priceCartWithBundles`.** `bundle-pricing.ts`
  prices a SET; this prices a CART, and it is the single point where a cart is grouped and allocated. Both
  checkouts, both cart views (including the authenticated cart's **optimistic** re-price after a removal — a
  `reduce` there would leave a discount on screen that checkout won't honour) and the selection toolbar call
  it, so displayed and charged cannot diverge. **Grouping is `(event, photographer)`**, never the whole cart:
  a discount must not be funded by another photographer's revenue, so a cart spanning two events discounts
  only the qualifying group; the pair rather than event alone keeps organizer events (several sellers) a gate
  change away rather than a redesign. It **fails closed to list price** — the direction that can only
  overcharge vs. intent, never undercharge — when the event is ineligible, has no schedule, has no `eventId`,
  or when a group's lines **disagree on the unit price** (a price change between two adds makes
  `quantity × unit` ill-defined). The **buyer service fee rides on the POST-DISCOUNT subtotal** in both
  checkouts and in `CartTotals`. **Exactly one surface quotes an event's price:** a configured schedule moves
  the whole price story to `EventPricingSection` (unit price + every package) and `EventMetaLine`
  **suppresses its price segment entirely** — repeating the unit price under the title is redundant, and on
  an event sold by the package it is the least relevant number to lead with; with no schedule the section
  renders nothing, so the meta line keeps the price. One-line offer display (purchase modal, selection
  toolbar — overlays where the section isn't visible) goes through the shared `getBestBundleOffer` +
  `resolveBundleOfferLabel` (`src/lib/bundle-offer-label.ts`), which picks the **deepest** offer (the cap,
  else the highest rung). The public page's schema.org `offers`
  becomes one Offer per rung via `buildEventOffers` (`src/lib/event-offers-json-ld.ts`) and stays a single
  bare Offer when there is no ladder. **"Add all my photos"** (after a face search, both viewers) takes its
  ids from the viewer's OWN match set — `faceSearch.matchedPhotos`, which on a reveal-gated event IS the
  proven set the reveal token was minted over — and **never** a fresh query for the event's photos; that id
  source is pinned by `test/unit/src/app/bundle-add-all-id-source.test.ts`, because breaking the gate is one
  call away and both versions compile. Note `event-card.tsx` renders **no** price, so cards needed no change
- **`bundle_all_photos_cents` (nullable `integer`, T-203) — "all photos for one price"** (Sportograf's
  Foto-Flat). A **CEILING**, not another rung: `price = min(quantity × unit, applicable rung, cap)`. Deliberate,
  because a rung needs a threshold the photographer would have to derive (`ceil(cap / price_per_photo)`) and that
  derived number **goes stale when the unit price changes** — a rung at "4+ for €20" silently stops applying if
  the price drops to €4, since €20 is then no longer a discount, and nobody is told. A ceiling keeps meaning what
  was typed: it engages exactly where `quantity × unit` would exceed it, so a buyer with 3 matches still pays per
  photo while one with 40 pays the flat price (which a threshold rung could not express). Independent of
  `bundle_tiers` — a cap with no rungs is a complete configuration ("€5 a photo, or €20 for all of them").
  Shown to buyers as the last row of the `EventPricingSection` table (T-204 — ticket A made it writable but
  never displayed it, so a configured Foto-Flat reached no buyer).
  Validated at write time: ≥ `MIN_PHOTO_PRICE_CENTS`, **strictly above** the unit price (at or below it the
  per-photo price is unreachable), and **strictly above every rung total** (a rung at or above the cap can never
  apply, so it is dead config). Consequence to know: once a buyer reaches the cap, adding their remaining photos
  is free — that is the Foto-Flat bargain, not a bug

**photos** (via `/src/database/queries/photos.ts`)
- `upload_status` (`pending`/`approved`/`rejected`) — **galleries render approved only**; owner
  uploads sit `pending` until the Inngest worker validates the bytes and promotes them
- `face_index_status` (`pending`/`indexing`/`indexed`/`failed`/`no_faces`/`not_applicable`) and `thumbnail_status` track the Inngest jobs; `width`/`height` persisted for layout
- Stored in Supabase Storage bucket: `photos`
- Watermarked previews served via `/src/app/api/watermark/`
- Full resolution only accessible via short-lived signed URLs after purchase
- **Soft-delete on sale (`deleted_at`, T-142):** a photo that has been SOLD (appears in a completed `order_items`/`guest_order_items` — the `getSoldPhotoIds`/`isPhotoSold` predicate) is **never hard-deleted**. Every delete path (`deletePhotoAction`, `updateEventAction`'s inline delete, `deleteContributorPhotoAction`, and `deleteEventAction`) checks the sold-set and, if sold, calls `softDeletePhotosByIds` (stamp `deleted_at`, keep the row **and** the storage object) instead of destroying it, so the buyer keeps permanent access. Unsold photos hard-delete + drop storage as before. The `ON DELETE RESTRICT` FK on `order_items.photo_id`/`guest_order_items.photo_id` stays as a hard fail-safe backstop; `orders`/`order_items` are never touched. **Query invariant:** every photographer/public/gallery/search/cart/cover/quota read filters `deleted_at IS NULL` (a miss resurfaces a deleted photo); buyer-facing reads (`getTalentPurchasedPhotos`, `getPurchasedPhotoIdsForEvent`, `getPhotoForDownload`, orders previews, guest download-token page) and the orphaned-storage-cleanup **in-use** set must **never** add that filter — a stray filter there deletes a paying buyer's bytes. The ZIP download route (`/api/events/[id]/download`) allows a buyer's purchased items even after the whole event is soft-deleted.

**photo_faces** (via `/src/database/queries/rekognition.ts`)
`photo_id, aws_face_id, aws_collection_id, confidence, bounding_box, indexed_at`
- One row per face AWS Rekognition indexes in a photo; unique on `(photo_id, aws_face_id)`
- Face embeddings themselves live inside the AWS collection — the DB only stores the returned `aws_face_id`. Talent selfie search maps AWS face IDs back to photo IDs here

**carts / cart_items**
`carts: id, user_id` — `cart_items: id, cart_id, photo_id, photographer_id, unit_price_cents, access_share_code`
- Guest cart stored in `localStorage` under `photo-markt_guest_cart`
- Guest cart merged into authenticated cart on login via `src/components/guest-cart-merge.tsx`
- **`allocated_price_cents` (nullable `integer`, T-204) — the COMMITTED bundle allocation.** When a ladder
  discounts a set, the buyer pays one discounted total but the purchasable unit stays the photo, so the
  total is split across the photos exactly (`allocateBundleTotalCents`, largest remainder) and the split is
  written here **before** the Stripe session is created. The webhook **reads** it (`allocated_price_cents ??
  unit_price_cents`) and **never recomputes** a bundle price from the event's tiers — the ladder is editable
  at any moment, and a recompute between the charge and a retried/late delivery would build an order that
  disagrees with the buyer's card statement. Null means "no bundle applied" and every reader falls back to
  the list price, which is exactly pre-bundle behaviour; only **discounted** groups are written
  (`discountedAllocations`), so the column stays empty for unbundled carts and rollback needs no migration.
  Writing it also **clears every other row in the cart first**, so a 5-photo bundle's allocation can't
  survive into a later 2-photo checkout. The guest flow needs no column — it commits the same allocation in
  the `c` field of the `cart_<i>` metadata it already writes
- `access_share_code` (nullable, T-134) persists the private-event share code the buyer presented at add/merge time — the access proof authenticated checkout re-validates against. Both `createCheckoutSessionAction` and the `getCurrentCart` self-heal drop/refuse an item unless its event is public now, its stored `access_share_code` still matches the event's `share_code`, or the buyer still has the photo tagged (live check) — parity with the guest checkout, closing the public→private-flip charge. Stored null for public events and the favorites/tag path; legacy rows (null) fail closed for private events

**Access proof is per-item and validated live.** Never treat the display-only `event_share_code` (the event's *current* code, joined for the `/events/[shareCode]` link) as the access proof — the proof is the persisted `cart_items.access_share_code`. The shared accessibility rule is `isEventAccessible` / `getAccessibleAuthedCartPhotoIds` (reuse, don't re-derive)

**orders / order_items**
`orders: id, user_id, cart_id, stripe_payment_intent_id, stripe_checkout_session_id, status, total_amount_cents`
- Status: `pending`, `completed`, `failed`, `refunded`

**payment_accounts** (legacy — unused)
`id, photographer_id, type, account_details, is_default, is_verified`
- Vestigial table from an earlier payout design. **Superseded by Stripe Connect**, whose account id + status live on `profiles.stripe_connect_account_id` / `profiles.stripe_connect_status` (migration `20260501000000_add_stripe_connect.sql`). No code under `src/app` or `src/components` references this table — do not build on it

**payouts**
`id, photographer_id, amount_cents, status, paid_at`
- Transfers fire **per order**, synchronously in the Stripe webhook on `payment_intent.succeeded` (one per `(order_item, photographer)`); this table is the historical record. There is no payout cron or minimum threshold. A manual admin-approval route exists at `/api/admin/payouts/[id]`, but is **currently vestigial** — nothing inserts `pending` payout rows (every payout is written straight to `paid` from the per-order transfer via `createPayoutFromTransfer`), so there is nothing to approve and no admin UI. Operational gaps in the transfer path: sub-50¢ net transfers are skipped with a warning (earnings stranded in the platform account), a non-active photographer's funds are held with only a `console.warn`, and refunds do **not** auto-reverse transfers. See `ARCHITECTURE.md` §4.3

**ai_search_profiles** (legacy — unused)
`id, user_id, activity_type, country, region, date_from, date_to`
- ⚠️ **No code references this table anywhere in `src/`** — vestigial like `payment_accounts`; do not build on it. The old `selfie_embedding` column was dropped (migration `20260518000000_drop_legacy_ai_schema.sql`) — selfies are sent to AWS Rekognition per search and never stored. The live per-event gating fields (`ai_matching_enabled`, `contains_minors`, `rekognition_collection_id`, `rekognition_region`, `ai_matching_status`) are on **`events`**, not here

**admin_users**
`user_id, granted_at, granted_by`
- Service-role-only access (RLS enabled, no policies — `anon`/`authenticated` cannot read or write)
- Used by `/api/admin/*` endpoints to gate access. Look up via `supabaseAdmin`, never via the user-scoped client
- Seed admins via direct DB access (Supabase SQL editor): `insert into admin_users (user_id) values ('<uuid>')`

**rate_limit_buckets**
`bucket_key, window_start, count`
- Service-role-only access (RLS enabled, no policies)
- Backs `src/lib/rate-limit.ts`. Atomic increments via the `increment_rate_limit_bucket` `SECURITY DEFINER` function — EXECUTE explicitly revoked from `anon` and `authenticated`
- One row per `(bucket_key, window_start)`. No automatic cleanup yet — fine at current scale

## Payments

### Photographer Subscriptions
Three plans: **Free** (8% commission), **Starter** (€9.99/mo, 4% commission), **Pro** (€29.99/mo, 0% commission).
Price IDs in env: `STRIPE_PRICE_AMATEUR`, `STRIPE_PRICE_PRO`.
Billing management in `/dashboard/photographer/settings/`.
`PLANS[].salesFeePercent` in `src/lib/plans.ts` is the single source of truth: `PLATFORM_FEE_RATES`
derives from it, and `test/unit/lib/pricing-consistency.test.ts` fails if the advertised copy drifts
from it. Rates were lowered from 12/8/5 in **billing v2** (T-194), deliberately in the *same* PR as
the buyer fee line item (T-196): Pro at 0% is only solvent while that fee is live, because the webhook
transfers `getPhotographerNetCents(gross)` and the platform absorbs Stripe's cost.

### Buyer service fee (billing v2 — T-194/T-195/T-196/T-197)
The buyer pays a **fixed + percent** fee on top of the cart subtotal, as its own visible Stripe line
item. The fixed part is what structurally covers Stripe's own fixed per-charge cost — a percent-only
commission cannot, which is why small sales used to sell at a loss.
- **Single calc point:** `getBuyerServiceFeeCents(subtotalCents)` in `src/lib/plans.ts`
  (`FIXED + round(subtotal × BPS / 10000)`; non-positive subtotal ⇒ 0). No checkout, cart, or earnings
  path may re-derive the fee inline — the charged and the displayed amount must come from here or a
  receipt can disagree with the cart (the PSD2 risk is surprise pricing, not the flat fee itself).
  Safe to call from the browser too, so the cart displays exactly what checkout charges.
- **Plain constants, deliberately NOT env vars:** `BUYER_SERVICE_FEE_FIXED_CENTS`,
  `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS` in `plans.ts`. These decide what every buyer is
  charged, so the review trail beats deploy-free tweaking: a constant gives a diff, a reviewer and a
  revertible commit, and a typo gets caught by a human rather than silently charging everyone.
  **Live since T-199: €0.25 + 3%, floor €1.50.** Setting all three back to **0** reproduces the pre-v2
  behaviour exactly — that is the rollback, and it needs no code change beyond the constants.
  `computeBuyerServiceFeeCents` is the pure kernel tests use to exercise other values.
- **Why €0.25 + 3%:** the fixed part covers Stripe's fixed per-charge cost and the percent part covers
  their percent — get either wrong and one end of the price range bleeds (a percent-only fee can't
  cover the fixed cost on a cheap photo; a percent below Stripe's own loses *more* the larger the
  sale). The binding case is a **Pro** sale: Pro is 0% commission, so the fee is the only thing
  covering Stripe there and the platform's margin on Pro comes from the subscription, not the sale.
  A card charging above 3% still leaves a thin negative tail on large sales — accepted for now; raise
  the bps if it grows.
- **Charged as its own Stripe line item**, never folded into a photo's price, via the shared
  `buildServiceFeeLineItem` (`src/lib/stripe/service-fee-line-item.ts`) in **both** checkouts (guest
  `cart/actions.ts`, authed `dashboard/talent/cart/actions.ts`). It rides on the **server-validated**
  subtotal — what survived the purchasability + accessibility gates — never a client figure, and
  returns `null` at fee 0 so the session stays identical to v1.
- **Displayed before Stripe** by the shared `CartTotals` (`src/components/cart-totals.tsx`), used by
  all four render sites (guest + authed cart, each desktop and mobile). It calls the same
  `getBuyerServiceFeeCents`, so displayed and charged cannot diverge. At fee 0 it renders exactly the
  single subtotal row it replaced.
- **The webhook is deliberately untouched.** Orders/`order_items` and the photographer transfer are
  rebuilt from cart metadata (guest) and `cart_items` rows (authed) — never from `session.line_items`
  — so the fee never inflates a photographer's gross or payout. Consequence to know:
  `orders.total_amount_cents` stays photo-only while `orders.metadata.amount_total` (raw Stripe) is
  photos + fee; they legitimately differ. Anything counting photos must use `metadata.cart_count`,
  **not** the line-item count (that bug bit the guest success page — see T-196).
- **Photographer earnings never include the fee.** It is platform revenue: not added to and not
  deducted from their figures. `calculatePlatformFee` (`queries/earnings.ts`) derives the commission
  as **`gross − getPhotographerNetCents(gross)`**, never `round(gross × rate)` — an independently
  rounded commission disagreed with the floored payout by a cent, so the breakdown didn't add up and
  the Earnings tab could contradict the Sales tab for the same sale. `gross = commission + net` is now
  true by construction. Both tabs now call the **same** `calculatePlatformFee`/`calculateNetEarnings`
  per line item (T-205 — the Sales action used to inline its own copy of the formula), so they cannot
  report different figures for one sale. `<BuyerFeeNote>` (`src/components/buyer-fee-note.tsx`) states
  this on both tabs and renders **nothing** while `isBuyerServiceFeeEnabled()` is false, so a fee
  nobody pays is never explained.
- **Earnings TOTALS are netted per order, not per period (T-205).** `aggregateEarningsByOrder`
  (`queries/earnings.ts`) sums `getPhotographerNetCents(orderGross)` over each order because that is
  the unit the money moves in — the webhook makes one transfer per `(order, photographer)`. Netting
  the whole period's gross in a single call reported up to a cent per order MORE than was ever
  transferred (a sum of floors is not the floor of a sum), which showed as a withdrawable balance that
  could never be withdrawn; bundle allocations land on arbitrary cents, so they make the drift more
  likely, not less. The per-**row** breakdown stays per line item (that is what keeps the two tabs
  identical), so a multi-item order's rows can sum to a cent under its payout — a display artefact of
  the per-photo split, not a discrepancy in the balance.
- **A bundled sale reports the CHARGED amount as gross.** `order_items.total_price_cents` carries the
  allocated share of the discounted total (T-204), so every sales/earnings surface already reads the
  money that came in, never `quantity × price_per_photo`. `<BundleDiscountNote>`
  (`src/components/bundle-discount-note.tsx`) says so on both tabs — the discount is the
  photographer's own price reduction, not a platform deduction and unrelated to the buyer fee — and
  renders **nothing** unless `hasBundlePricingConfigured` (`queries/events.ts`, fails **closed** on
  error since the bundle columns are migration-gated) finds a ladder or cap on one of their events.
- **Minimum photo price:** `MIN_PHOTO_PRICE_CENTS` is a floor on a *priced* event, enforced at write
  time in both event actions via `isPhotoPriceAboveFloor` (create + edit `superRefine`), **not** as a
  DB constraint — so an event priced below a later-raised floor keeps working until its price is next
  written. Free events (`null`/0) are exempt; a floor of 0 disables the rule. The rejection travels to
  the client as the parseable sentinel `MIN_PHOTO_PRICE:<cents>` (`src/lib/min-photo-price.ts`,
  same scheme as `plan-limits.ts`) because server actions have no dictionary. ⚠️ Next redacts thrown
  Server Action messages in prod (the T-189 finding), so the localized copy only renders reliably in
  dev — same caveat as `PlanLimitError`.

### Photo Purchases (Talent)
One-time Stripe payments. Webhook handler at `/src/app/api/stripe/webhook/route.ts`.
After confirmed payment: order saved, cart cleared, photos available in talent profile and orders.

### Photographer Payouts (Stripe Connect)
- Photographers connect Stripe Express accounts in `/dashboard/photographer/settings/payout-profile/`
- Photo Markt absorbs the Stripe Connect fee (0.5%) — photographer always receives exactly their promised net amount
- Transfers fire per order, synchronously in the `payment_intent.succeeded` webhook handler — there is no cron or minimum threshold (see `ARCHITECTURE.md` §4.3)
- Sales and earnings share one tabbed page at `/dashboard/photographer/sales/` (`?tab=earnings` selects earnings); `/ventas`, `/ganancias`, `/earnings` are redirect aliases to it

## Shared Components

```
src/components/
  ui/
    photo-action-icon.tsx     # Shared photo action icon (dark bg, white icon, tooltip)
    location-autocomplete.tsx # Google Places autocomplete for event forms only
  event-search-bar/           # Search bar with filter modal (Airbnb-style)
    EventSearchBar.tsx
    ActivityDropdown.tsx
    WhenPopoverContent.tsx
    WhereSuggestionsDropdown.tsx
  photo-lightbox.tsx          # Full-screen photo viewer
  guest-cart-merge.tsx        # Handles merging guest cart on login
  pricing-section.tsx         # Pricing plans UI
```

## Photo Action Icons

The `PhotoActionIcon` component (`src/components/ui/photo-action-icon.tsx`) is the standard for all photo action buttons:
- **Style:** Dark semi-transparent background (`bg-gray-900/60 backdrop-blur-sm`), white icon
- **States:** Outline icon = inactive, filled icon = active. No color changes — only outline vs filled.
- **Visibility:** Always visible on mobile, visible on hover on desktop (handled by parent with `group` + `md:opacity-0 md:group-hover:opacity-100`)
- **Tooltip:** Always included via Shadcn `Tooltip`
- **Consumed via** `photo-icon-buttons.tsx`, `photo-more-menu.tsx`, `event-save-button.tsx` — pages use those wrappers, not `PhotoActionIcon` directly (there is no `/events/[slug]` route; the public event route is `/events/[shareCode]`)

## Event Search

Search bar (`src/components/event-search-bar/`) queries Supabase directly — no external APIs:
```sql
events.name ILIKE '%query%'
OR events.city ILIKE '%query%'
OR events.country ILIKE '%query%'
-- photographers matched separately: profiles.username OR profiles.display_name
```
(`src/database/queries/events.ts:415` and `:487`)
- Results grouped by type: events and photographers
- Filters (Activity, When) in a separate modal opened by a Filters button outside the input
- Google Places API used **only** in location field of event create/edit forms — never in search

## Image Handling

- Original photos: Supabase Storage (private)
- Previews: protected via `/src/app/api/watermark/` — the route picks the treatment server-side from the photo's event (never from the caller, and only from a photos row whose `event_id` matches the path's event segment): tiled watermark + degraded quality for `watermark_enabled` events, the clean baked-medium-thumbnail treatment for events selling without a visible mark (T-133). Unknown policy fails closed to the watermark treatment
- Purchased photos: short-lived signed URLs — never expose original storage path publicly
- Watermark: tiled repeating pattern, server-side via Sharp
- **Who may set `watermark_enabled` is one shared rule (T-211): `src/lib/watermark-policy.ts`.** A **private
  non-organizer** event is already protected by its share code, so the visible watermark is forced **off**
  whatever the form sent; **organizer** events are exempt because they are *always* private (access is the
  membership join table, so without the carve-out none could ever be watermarked). `resolveWatermarkEnabled`
  is called by both event actions and `isWatermarkConfigurable` by both forms + the wizard review, so the
  switch renders **disabled and off** exactly where the save would override it. The rule had drifted into four
  hand-written copies and two disagreed: `updateEventAction` had lost the organizer branch (any edit — even a
  rename — stripped an organizer event's watermark), and the edit form had no copy at all, so a private event
  offered a switch the save silently discarded. The server stays the authority; the disabled switch is UX.
  ⚠️ Do **not** "simplify" by dropping the private-event rule — `needsProtectedPreview` reads
  `watermark_enabled`, so flipping it changes how existing events' previews are served
- For-sale photos (watermarked or not) must never resolve to a direct signed full-res original pre-purchase. Enforced via the shared predicate `needsProtectedPreview` (`src/lib/preview-protection.ts`, T-131/T-133/T-136) in the cart pre-bake fallback (`getPhotoPreviewUrls`), every gallery signing site (public event page + load-more, talent event view, talent dashboard, favorites), and the **event-card cover + `og:image` fallbacks** (T-140, via the shared chokepoints `signEventCoverUrls` / `resolveEventOgImageUrl` in `src/database/queries/event-covers.ts` — used by talent explore, saved events, photographer profile, and the public event page's `generateMetadata`): anything watermarked OR for-sale (`price_per_photo` non-null — 0 counts, matching `isForSale` and the download gates) routes through `/api/watermark/`; only an event positively known to be free (null price) AND un-watermarked keeps the direct signed original. A **dedicated cover image** (T-055, `events.cover_path`) is always direct-signed — it's a promotional presentation image, not a for-sale photo (and isn't a `photos` row, so the watermark route can't resolve a policy for it). New signing sites must use the predicate — never re-derive "is it watermarked?" locally
- **Uploads:** all paths (photographer + guest collaborative) validate via `src/lib/photo-upload.ts` before writing to storage. Magic-byte check via Sharp, 50 MB per-file cap, content-type and extension are derived from the detected format — `file.type` and `file.name` are never trusted. `validatePhotoBuffer`/`validatePhotoUpload` accept a per-call `{ maxBytes, allowedFormats, tooLargeMessage }` override (defaults preserve photo behavior) so other upload paths reuse the exact magic-byte detection with tighter limits

## Profile pictures / avatars (T-182)

Users change their avatar from `dashboard/{photographer,talent}/settings/profile` via the shared client component `src/components/avatar-upload.tsx` + the shared Server Action `src/app/[lang]/actions/avatar.ts` (`updateAvatarAction` / `removeAvatarAction`). This is the **second storage bucket**: `avatars` — **public** (migration `20260726000000_create_avatars_bucket.sql`), unlike the private `photos` bucket, because avatars render as plain `<img src>` on public pages.

- **Write path:** the action authenticates the user, rate-limits (`avatar-upload:<userId>`, 20/h), validates via `validateAvatarUpload` (`src/lib/avatar-upload.ts` — magic bytes, **8 MB** cap `MAX_AVATAR_BYTES` from `src/lib/avatar-constants.ts`, allow-list jpeg/png/webp/heif/avif; tighter than photos), re-encodes to a **square 256px WebP** (`resizeAvatar`, `fit:'cover'` — raw upload is never stored), and uploads to `avatars/<userId>/<uuid>.webp` via **`supabaseAdmin`** (RLS-bypass; path derived from the authed id). No per-object write RLS policy exists on `avatars` — anon/authenticated are default-denied, so the admin-backed action is the only writer.
- **`profiles.avatar_url` is the DURABLE source of truth.** It's the authoritative single write (public profile + event cards read it; the two dashboard layouts now also read it for the header/nav/bottom-nav chrome via `getProfileFields(..., ['display_name','avatar_url'])`, preferring it over auth metadata). The auth `user_metadata.avatar_url` write is a **best-effort, non-fatal** sync (via `syncAuthAvatarMetadata`, which checks the returned `{error}` — `updateUserById` does NOT throw) only so the **public-site** header (`user-avatar.tsx` via `useAuthUser`, which reads auth metadata) reflects the change immediately. **Why metadata is not authoritative:** this app is Google-OAuth-only and GoTrue re-syncs `user_metadata.avatar_url` from the Google identity on every sign-in, so a custom avatar written there reverts on next login — the durable render path must never depend on it. The client calls `router.refresh()` after success. **Ordering discipline in the action:** validate → throttle → read prior avatar/slug → upload → **authoritative `updateProfile` write** (on failure, delete the just-uploaded object) → best-effort metadata sync → delete-on-replace → revalidate. Validation runs before the throttle (a bad pick costs no quota); the profile read runs before the upload (a read error can't orphan a fresh object).
- **Delete-on-replace:** the previous object is deleted in the same action — `avatarObjectPathToDelete(url, userId)` returns a path to remove ONLY when the URL is our `avatars` bucket AND under `<userId>/` (Google OAuth URLs and foreign paths return null, fail-closed). The `photos` orphan-cleanup cron does NOT cover `avatars`.
- **Errors are returned, not thrown:** `AvatarActionResult` is a discriminated union (`{ok:true,avatarUrl} | {ok:false,error: AvatarErrorCode}`) so the reason survives the RSC boundary (thrown messages are redacted in prod); the client maps codes → localized `dict.avatarUpload.*` copy.
- **Legacy `avatar_url`:** existing rows point at the Google OAuth URL (full URL). The render layer only passes the string as `src`, so uploaded-WebP and Google URLs coexist; existing rows are not migrated.

## Reveal gate — search-only events (T-177)

Per-event setting `events.reveal_gate_enabled`: the event stays **publicly discoverable** but its photos are **not browsable** — they're revealed only to a visitor who proves a **face-search** match (v1 is face-only; no bib unlocking). Distinct from `is_public`/`share_code`, which gate **access to the event**; the reveal gate gates **visibility of the photos** within it. They compose (AND): `isEventAccessible` decides the event, the gate decides its photos.

- **Enable preconditions** (enforced in `events/new/actions.ts` + `.../[id]/edit/actions.ts`, fail-closed): requires `ai_matching_enabled = true` (face search is the only key); forced off otherwise. **Minors are out of scope** — a new invariant enforces `contains_minors ⇒ !is_public` in both directions (create + edit), so minors events are always private and get their privacy from the share code, not this gate.
- **Enforcement is at the LISTING paths only** — the fail-closed gate withholds photo IDs/URLs from an unproven visitor: the public event page's initial fetch + count (`events/[shareCode]/page.tsx`, gated → skip the cached photo fetch, fetch the proven set per-request outside `'use cache'`), `loadMoreEventPhotos` (gated → `[]`), the talent-dashboard event view (same), and `resolveEventOgImageUrl` + the card-cover chokepoint `signEventCoverUrls` (suppress the first-photo fallback for gated events; dedicated cover still shown). **Reads gated by `isEventRevealGated(event)`** (`src/lib/reveal-token.ts`); the proven set is fetched via `getEventPhotosPublicByIds` (intersects the proof ids with the approved public set — a stale/foreign id can't surface a photo).
- **Proof = signed cookie** `pm_reveal_<eventId>` (HMAC, `src/lib/reveal-token.ts`; request-scoped read/write in `src/lib/reveal-gate.ts`). `searchFacesInEvent` mints it over the matched ids so a reload re-serves them with no second billable face search. Fail-closed on tamper/expiry/wrong-event. Env `REVEAL_TOKEN_SECRET` (optional; falls back to the service-role key).
- **Security property (v1 — deliberate):** the image byte routes (`/api/watermark`, `/api/thumb`) are **NOT gated**; they serve by an unguessable storage path, so with no ID in hand a visitor has nothing to request — **the UUID is the secret**. The property is "photo IDs never reach an unproven visitor + exposure is limited", NOT byte-level access control. **⚠️ Any future feature that surfaces a gated event's photo URL or ID to an unproven visitor breaks this** — new listing endpoints/embeds/exports must route through the gate. Also: an event that was public and later gated already leaked its UUIDs, so the gate is partial for it (marginal — requires pre-harvested IDs). Cart/checkout/download are untouched (they need an ID the unproven visitor lacks).
- **UX:** the total photo count moves next to the header when gated (worth searching); the toolbar counter shows only what's revealed (nothing pre-search); the gallery shows an intentional "search to find your photos" state.
- **Dead-end guard (T-184):** because a gated event reveals photos ONLY via face search, if the face-search entry can't render (the event isn't searchable yet — nothing indexed, indexing in flight, or indexing failed) the visitor would be stranded with no photos and no way to find them. Both viewing surfaces (`events/[shareCode]/page.tsx` + `dashboard/talent/events/[id]/page.tsx`) resolve `resolveGatedFaceSearchNotice({ gated, aiSearchEligible, aiUsable, aiStatus })` (`src/lib/find-my-photos.ts`) and, for a gated event that isn't eligible, render `<GatedFaceSearchNotice>` — a `'processing'` state (AI usable + status `idle`/`indexing`; `idle`+nothing-indexed is the reported T-183/T-099 backfill-reliability case) or a `'unavailable'` state (failed / done-but-nothing-searchable / AI not usable) instead of the mute empty gallery. Non-gated events are unaffected (they browse normally, so hiding the empty face-search entry is correct). The guard does NOT loosen the gate — it never exposes a photo without a match.

## Security Utilities

The `src/lib/` modules below enforce conventions across the app. Use them — don't reinvent.

**`src/lib/photo-upload.ts`** — `validatePhotoUpload(file)`
Reads magic bytes via Sharp, rejects unknown formats, caps per-file size at 50 MB. Returns `{ buffer, contentType, extension }` derived from the detected format. Apply on every upload path before writing to storage.

**`src/lib/json-ld.ts`** — `stringifyJsonLd(value)`
Use this instead of `JSON.stringify` whenever embedding structured data in an inline `<script>` via `dangerouslySetInnerHTML`. Escapes `<`, `>`, `&`, U+2028, U+2029 so a user-supplied field containing `</script>` cannot break out of the script block.

**`src/lib/rate-limit.ts`** — `rateLimit({ key, limit, windowSec })`
Postgres-backed fixed-window limiter. Apply to:
- Endpoints that hit external APIs (Stripe, Resend) on every call
- Endpoints with sequential or guessable id parameters (admin endpoints)
- Unauthenticated endpoints with side effects (guest uploads)

Helpers: `getClientIp(headers)` for unauthenticated keying, `retryAfterSeconds(result)` for the `Retry-After` response header. Fails open on backend errors. Backend is pluggable via the `RateLimitBackend` type — currently Postgres, swappable to Upstash/Redis later without touching call sites.

**`src/lib/auth/require-user.ts`** — `requireUser()`
Returns the request's authenticated user or redirects to login (`redirectToLogin()`), reading through
the request-cached `getUser()` so every segment of one render shares a single auth snapshot.
**Call it first in every dashboard layout/page that reads auth-dependent data** — Next renders a
route's segments *in parallel*, so the login guard in `dashboard/layout.tsx` does **not** stop a child
layout or page from executing. A child that reacts to a missing session by *throwing* (`getRoleContext`,
`getProfileFields(supabase, '')`, `getDashboardData`, …) races the parent's `NEXT_REDIRECT` into
`[lang]/error.tsx` — that race was T-198's intermittent "Something went wrong" screen on
`/[lang]/dashboard/talent`. Redirecting instead of throwing makes the race harmless: every competing
outcome becomes a redirect. Pinned by `test/unit/src/app/dashboard-auth-guard.test.ts` (behavioral) and
`dashboard-guard-coverage.test.ts` (the list of segments that must guard — add new ones there).

**`src/lib/auth/safe-next.ts`** — `safeNext(value)`
Use for any redirect destination derived from user input (`?next=`, OAuth callback, etc). Rejects protocol-relative URLs (`//evil.com`), backslash variants, and control characters.

## Testing

The project uses **Vitest** for tests and **Supabase local** (Docker) for integration tests that need a real database. Detailed conventions and debugging tips live in [`test/README.md`](./test/README.md).

### Commands

| Command | What it does |
|---|---|
| `pnpm test` | Run every test once (integration tests assume the local Supabase stack is already up) |
| `pnpm test:unit` | Unit tests only (`test/unit`) — no Docker, fast inner loop |
| `pnpm test:integration` | Boots Supabase, runs `test/integration`, then stops it — Docker only lives during the run |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Run + write coverage report under `coverage/` |
| `pnpm db:start` / `db:stop` / `db:reset` | Boot or reset the local Supabase stack (Docker required) |

### Directory layout

```
test/
  unit/                # No Docker. Mostly pure functions; mocks used where needed
    lib/               # Helpers under src/lib/ (largest group)
    src/{lib,app}/     # Newer tests mirroring the src/ path
    actions/ api/ components/  # Mocked Server Actions, route handlers, RTL components
  integration/         # Hit local Supabase via test helpers
    actions/           # Server Actions
    api/               # API route handlers (Stripe webhook, etc.)
    queries/           # src/database/queries/* layer
    security/          # RLS regression tests
    inngest/           # Background-job handlers against the real DB
  helpers/
    supabase-test-client.ts   # createTestUser / createTestEvent / resetDatabase / ensurePhotosBucket
    server-action-mocks.ts    # shared mockSession for Server Action tests
    database-server-mock.ts   # mocked Supabase server client for unit tests
    image.ts                  # synthetic image buffers for upload tests
  setup.ts             # env-var defaults loaded before each test file
```

Vitest discovers any file under `test/` matching `*.test.ts(x)`.

### Conventions

- **Every bug fix should ship with a regression test.** The test should fail before the fix and pass after.
- **Every new feature should include tests for the critical paths** — Server Actions, queries, payment flows, security helpers. UI polish can ship without component tests for now; payment/auth/data flow cannot.
- **Choose the right client deliberately** in integration tests: service-role to assert *query behavior*, anon/user-scoped to assert *RLS behavior*. Helpers in `test/helpers/supabase-test-client.ts` make both easy.
- **Use `beforeEach(resetDatabase)`** in integration tests so ordering can't quietly pass or fail one.
- **Keep helpers pure where possible** — pure functions are testable without a DB and make unit tests cheap to write.

### Coverage target

The goal is **60% on lines, branches, functions, and statements**. Thresholds are not enforced in `vitest.config.ts` yet — the report is informational until we've written enough tests to clear the bar. Flip the gate on (uncomment `thresholds:` in the config) when ready.

### Troubleshooting

- **Integration tests fail en masse with `permission denied for table …` (code `42501`):** the local API roles (`anon`/`authenticated`/`service_role`) are missing their DML grants on `public` tables — a known fallout of Supabase CLI provisioning. The grants live in `supabase/seed.sql` (local-only; never runs against production); run `pnpm db:reset` once to apply them. The pre-flight in `test/helpers/supabase-test-client.ts` surfaces this as a single "Local Supabase is not provisioned for tests" error.

## AI Photo Search

**Enabled** (`AI_MATCHING: true`). Implemented with **AWS Rekognition face collections** + **Inngest** background jobs — not the old pgvector/CLIP embedding path, which was removed in migration `20260518000000_drop_legacy_ai_schema.sql`.

- **Indexing (photographer side):** a new photo emits a `photo.uploaded` Inngest event. `indexPhotoFaces` (`src/lib/inngest/functions/index-photo-faces.ts`) downloads the image, calls Rekognition `IndexFaces`, and writes `photo_faces` rows; `generatePhotoThumbnails` runs in parallel off the same event. Enabling AI on an existing event fans out via `backfillEventIndexing`; disabling or deleting an event tears down the AWS collection (`disableEventIndexing` / `cleanupOnEventDelete`).
- **Search (talent side):** `searchFacesInEvent` (`src/app/[lang]/events/[shareCode]/actions.ts`, surfaced by `src/components/event-gallery-with-face-search.tsx`) validates a selfie, calls Rekognition `SearchFacesByImage` (threshold 80), maps matched face IDs to photos via `getPhotoFacesByAwsFaceIds`, filters to public/approved/non-minor photos, and buckets results (`very-likely` 95+, `likely` 85+, `possibly` 80+). Selfies are ephemeral — never persisted.
- **AWS calls** (`src/lib/aws/`): `CreateCollection`/`IndexFaces`/`SearchFacesByImage`/`DeleteFaces`/`DeleteCollection`. Collections are named `${REKOGNITION_COLLECTION_PREFIX}-${env}-event-${eventId}` (`src/lib/aws/collection-naming.ts`).
- **Error safety:** every AWS/Sharp/Storage call in these flows is wrapped in `safeCall` (`src/lib/safe-call.ts`) so image buffers can't leak into Inngest step output or serverless error responses.
- **Backfill de-duplication (T-089):** the two per-event backfill workers (`backfillEventIndexing`, `backfillEventBibDetection`) are cost gates — each fans out one AWS-billed job per photo. Both declare `debounce: { key: 'event.data.eventId', period: BACKFILL_DEBOUNCE_PERIOD }` (`src/lib/inngest/functions/backfill-config.ts`) so a double-click / double-submit / enable→re-index burst collapses into a single run, plus `concurrency: [{ limit: 1, key: 'event.data.eventId' }]` as a backstop that serializes any runs that still overlap. Debounce (a sliding window) is used deliberately over an event-`id` idempotency key, whose 24h dedup memory would silently drop a legitimate later re-index — or a disable→re-enable — that reused the same key. The trigger sends (`event.ai-matching-enabled` / `event.bib-detection-enabled`) and the per-photo `photo.uploaded` / `photo.bib-detect` fan-out sends carry **no** dedup key — a re-index must legitimately re-process each photo.
- **Rate limits / cost controls (T-034)**: anonymous face search is gated by **three tiered atomic Postgres counters** (all keyed on the resolved `event.id`, incremented via `rate_limit_buckets` + `SECURITY DEFINER` RPCs, decided on the RETURNED count so a concurrent burst can't undercount): **(1)** per-`(event, IP)`/hour request throttle (10/h — the pre-existing limiter; it **is** Postgres-backed and atomic, not in-memory); **(2)** per-**event**/day cost cap; **(3)** global/day **circuit breaker**. Tiers 2 & 3 count **real billable AWS calls** — `AWS_CALLS_PER_FACE_SEARCH` in `src/lib/face-search-limits.ts`, which is **1**: a search issues exactly one billable `SearchFacesByImage` op (detection + search bundled — there is **no** separate `DetectFaces` call). Order matters: tier 1 and selfie validation run **before** the cost counters, so an IP-throttled or garbage-payload attacker can't inflate the global breaker (which would deny face search platform-wide for free); a per-event trip never touches the global counter. Caps are **env-configurable** (`FACE_SEARCH_GLOBAL_DAILY_CALLS` default 2000, `FACE_SEARCH_EVENT_DAILY_CALLS` default 1000) — never hardcoded — so they can be raised the day a real 300-runner event's athletes start searching. A **50%-of-global email alert** (Resend, `FACE_SEARCH_ALERT_EMAIL`; absent ⇒ no-op) fires once per day-window via an atomic claim bucket. On a breaker trip the SA throws `RATE_LIMIT:face-search:unavailable` → the modal shows a localized "temporarily unavailable" (`aiSearch.modal.errorUnavailable`); **bib search and the rest of the app are unaffected** (separate, non-AWS path). CAPTCHA is deliberately **not** built here (tripwire T-141). There is still **no per-plan monthly search quota** — a half-built version (`ai_search_usage` + `AI_SEARCH_RATE_LIMITS`) was removed in T-036 because the anonymous searcher isn't the plan owner; don't re-advertise a "N searches/month" number.
- **Indexing-state reconciliation (T-099, T-183):** `reconcileIndexingState` (`src/lib/inngest/functions/reconcile-indexing.ts`) runs **every 30 min** (`15,45 * * * *`, offset from the storage-cleanup cron at `0,30 * * * *`) and self-heals three silent wedges with no other recovery path: an event stuck in `ai_matching_status='indexing'` forever (a lost `photo.uploaded` or a missed `maybe-mark-event-ready` step), a thumbnail that never bakes (a swallowed best-effort `emit-processed`), and (T-183) an **owner upload stranded in `upload_status='pending'`** (a lost `photo.uploaded` or a run that died before the worker's `promote-upload-status` step — invisible on the approved-only galleries AND absent from the owner's Pending tab, so the dashboard count says N while only the approved subset renders). It (a) re-emits `photo.uploaded` for still-in-flight photos of wedged events, (b) flips events whose in-flight count is already 0 to `ready`, (c) re-emits `photo.processed` for terminally-indexed photos whose `thumbnail_status` is still `pending`, and (d) re-emits `photo.uploaded` for **owner uploads** stuck `upload_status='pending'` in events **not** wedged in `indexing` (branch (a) owns that case) — re-driving download → byte-validation → promotion via the real worker rather than flipping the row to `approved` here, so the byte-validation gate is never skipped. The owner-upload predicate is `photos.user_id = events.user_id` AND `guest_name IS NULL` AND `uploaded_by IS NULL` (`listStuckPendingOwnerUploads` in `photos.ts`; the column-to-column comparison is applied in JS after an inner-join fetch, since PostgREST can't express it). A **1-hour staleness gate** keyed on the trigger-maintained `events.updated_at` (for events) / `photos.created_at` (for thumbnails and owner uploads) keeps it from clobbering live re-indexes; `failed` photos are left alone (they exhausted retries — re-index is a manual action, no retry storm). Idempotent + the T-092 ready-guard stops any re-emit from re-baking an already-`ready` thumbnail.
- **Worker route:** all Inngest functions are registered at `/src/app/api/inngest/route.ts`.

## BIB number recognition (T-032)

Race **bib-number** detection, **per-event opt-in** (the cost gate, mirroring `ai_matching_enabled`). Shares the Rekognition client + Inngest + `safeCall` conventions with face matching.

- **Opt-in:** `events.bib_detection_enabled` (default false) + `bib_detection_status`. Photographer toggles it on the event detail page (`enable/disableBibDetectionForEvent`, owner-only); enabling fires `event.bib-detection-enabled` → `backfillEventBibDetection`. Disabled for `contains_minors` events (parity with face search). Disabling **keeps** existing bib rows.
- **Detection (job):** `detectPhotoBibs` (`src/lib/inngest/functions/detect-photo-bibs.ts`) on `photo.uploaded` + `photo.bib-detect`; no-ops (status stays NULL) unless the event opted in. Downloads the image, calls Rekognition `DetectText` (`src/lib/aws/bib-detection.ts`), filters to plausible bibs (`extractBibCandidates` in `src/lib/bib-numbers.ts` — confidence floor + digit-dominant pattern + dedupe + cap), persists to `photo_bib_numbers`. Bytes never cross Inngest step boundaries; AWS/Storage/Sharp wrapped in `safeCall`. Backfill fans out a **bib-specific** `photo.bib-detect` event so it never re-runs the face/thumbnail jobs.
- **Persistence:** `photo_bib_numbers` (`photo_id`, `bib_text`, `confidence`, `bounding_box`, unique `(photo_id, bib_text)`) — RLS read like `photo_faces`, service-role writes only. **This table is both the raw detection data and the search target: bib search matches on `bib_text`, one row per bib per photo.** `photos.bib_detection_status` is the per-photo **job status** only (nullable; `pending`/`detecting`/`detected`/`no_bibs`/`failed`/`not_applicable`) — it never holds bib values. Queries in `src/database/queries/bib-numbers.ts`.
- **Search (talent):** `searchPhotosByBibInEvent(shareCode, bib)` (`events/[shareCode]/actions.ts`) — exact normalized match, rate-limited `(shareCode, IP)` 30/h, returns matching **public** photo ids. Surfaced via the unified `FindMyPhotosBanner` (`src/components/find-my-photos-banner.tsx` — the face + bib "Find my photos" card; bib input opens in a modal) on both the public event gallery (`/events/[shareCode]`) and the talent-dashboard event view (`/dashboard/talent/events/[id]`), gated on `bib_detection_enabled`; results filter the grid client-side on **both** surfaces (symmetric wiring — the old talent-dashboard grid-filter gap is fixed). Enabling/disabling bib detection busts the public/talent event cache tags (`revalidateEventPhotoCacheTags`) so the bar appears/disappears immediately (T-064).
- **Privacy:** bib numbers are low-sensitivity race identifiers (not PII); selfies/faces unaffected. `contains_minors` parity keeps minors' photos no more exposed than face search already allows.
- **Cost:** `DetectText` is billed per image on opted-in events — the per-event opt-in is the only throttle (no per-event cap yet). No new env vars (reuses `AWS_*`/`REKOGNITION_*`).

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_AMATEUR=        # Starter plan monthly price ID
STRIPE_PRICE_PRO=            # Pro plan monthly price ID
STRIPE_PRICE_AMATEUR_YEARLY= # Starter yearly price ID (optional; required only once yearly checkout is enabled)
STRIPE_PRICE_PRO_YEARLY=     # Pro yearly price ID (optional; same as above)

# Google
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=   # Places API — event location forms only

# AWS Rekognition (face indexing, feature-flagged via AI_MATCHING)
AWS_REGION=                          # default eu-west-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
REKOGNITION_COLLECTION_PREFIX=       # default "photomarkt"; namespace per env

# Face-search cost controls (T-034) — all optional, safe defaults
FACE_SEARCH_GLOBAL_DAILY_CALLS=      # global/day circuit breaker, default 2000 (~$2/day)
FACE_SEARCH_EVENT_DAILY_CALLS=       # per-event/day cap, default 1000
FACE_SEARCH_ALERT_EMAIL=             # 50%-of-global alert recipient; absent ⇒ no alert

# Reveal gate (T-177)
REVEAL_TOKEN_SECRET=                 # optional; falls back to the service-role key

# Ops
HEALTH_CHECK_TOKEN=                  # optional; /api/health/ready 401s until set
NEXT_PUBLIC_VERCEL_URL=              # optional; base-URL resolution on previews

# Inngest (background-processing worker for face indexing)
INNGEST_EVENT_KEY=                   # signs outbound inngest.send() calls
INNGEST_SIGNING_KEY=                 # verifies inbound webhook payloads at /api/inngest

# Email
RESEND_API_KEY=
# Sender is hardcoded ('Photo Markt <noreply@photomarkt.com>') in src/lib/email/*.ts

# Sentry error monitoring (all optional — SDK is a no-op without a DSN)
SENTRY_DSN=                          # server/edge DSN; absent ⇒ no server error capture
NEXT_PUBLIC_SENTRY_DSN=              # browser DSN; absent ⇒ no client error capture
SENTRY_ORG=                          # build-time only (source-map upload)
SENTRY_PROJECT=                      # build-time only (source-map upload)
SENTRY_AUTH_TOKEN=                   # build-time only; source maps upload only when set

# App
SITE_URL=
```

## Branches

One branch = one ticket = one draft PR. Prefixes in use: `feat/`, `fix/`, `chore/`, `design/`.
~140 merged remote branches exist; `main` is the only source of truth for what shipped — never
read a branch name as a feature's status.

## Working with Claude

### When to use Planning Mode
Only use planning mode when:
- The feature touches more than 5 files
- The architecture is genuinely unclear
- It involves payments, auth, or security-sensitive code

Skip planning mode for: bug fixes, UI tweaks, adding fields, isolated features, translations, refactoring individual files.

### Token Budget Guidelines
- Bug fixes: 3–8k tokens
- UI changes / isolated features: 5–15k tokens
- Medium features (3–5 files): 15–25k tokens
- Large features (payments, auth, multi-page): 25–40k tokens

### Prompt Best Practices
- Always specify the branch to work on
- Reference specific file paths when known
- Add "Do not ask for confirmation — proceed autonomously" for low-risk tasks
- For bugs: describe exact symptoms and where they occur
- Always end prompts with "No other changes"

### Code Conventions
- All visible strings must be in both `en.json` and `es.json`
- All Supabase queries go in `/src/database/queries/`
- All mutations use Server Actions — not API routes
- Use existing Shadcn components — do not introduce new UI libraries
- Use Biome for formatting — not Prettier
- New env vars must be added to `env.mjs`
- No `any` types in TypeScript
- All async functions must have proper error handling — no silent catches
- New features should include tests for critical logic (Server Actions, queries, payment flows). Bug fixes should include a regression test that fails before the fix and passes after

### Security Conventions
- File uploads must validate via `src/lib/photo-upload.ts` — never trust client-supplied MIME or extension
- JSON-LD inside `dangerouslySetInnerHTML` must use `stringifyJsonLd` — never raw `JSON.stringify`
- Admin endpoints check `admin_users` via `supabaseAdmin` — there is no `profiles.is_admin` column
- New `SECURITY DEFINER` functions in the `public` schema must explicitly `revoke execute ... from anon, authenticated` — Supabase grants those by default and `revoke from public` doesn't override role-specific grants
- Tables with no public access pattern: enable RLS with no policies, use `supabaseAdmin` only — see `admin_users` and `rate_limit_buckets` for the pattern
- Redirect destinations from user input must go through `safeNext()` from `src/lib/auth/safe-next.ts`
- Permissive RLS policies (`USING (true)`) are forbidden on tables with sensitive writes — service-role bypasses RLS, so the webhook/admin paths still work after locking down user-facing roles
