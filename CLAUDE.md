# CLAUDE.md

This file provides guidance to Claude Code when working with the Photo Markt codebase.

**It carries the rules — the invariants and prohibitions that must be loaded every session, because
they are what stops a fixed bug from being reintroduced.** The *history* behind them — what went
wrong, what it cost, which alternative was rejected — lives in
[`backlog/DECISIONS.md`](./backlog/DECISIONS.md), keyed by ticket id: a `(T-249)` here is the anchor
to search for there. Read the matching section of that file **before touching that area**, not before
every task. Flows and diagrams are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

If you find an actionable rule that lives only in `DECISIONS.md`, it belongs here too.

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
pnpm advisors:check # Supabase security advisors vs. the accepted baseline (needs SUPABASE_ACCESS_TOKEN)
pnpm ops:drift    # Does each environment run what the repo says? (migrations · Inngest · Stripe webhook)
```

**`pnpm ops:drift` (T-256) answers the question no test can:** the repo and an environment can disagree
with nothing to notice, and the four times that happened here cost more than any code bug — a Stripe
webhook on the apex host (307, every delivery dead, T-192), 5 of 13 Inngest functions synced (T-125), a
migration never applied (Actions minutes ran out mid-merge), and a migration applied and then **edited**
(T-204). It is **read-only** — it applies nothing, re-syncs nothing, reconfigures nothing — and exits
non-zero on drift. Pinned environments live in `scripts/ops-drift-environments.ts`; each credential is
named per environment and **never falls back**, because a fallback is how a run reads the local test-mode
Stripe key while claiming to report on production. A missing credential SKIPs its check, loudly.
⚠️ Its env vars are deliberately **not** in `env.mjs`: that validates the *app's* runtime environment, and
adding ops-only credentials there would make the app refuse to boot without them (same reason
`SUPABASE_ACCESS_TOKEN` is not there either).

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
- **Background jobs**: Inngest (face indexing, thumbnail generation, storage cleanup, indexing-state reconciliation, payout retries) served at `/api/inngest`
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
    watermark/[...path] # Protected preview serving
    thumb/[...path]     # Baked thumbnail serving
    events/[id]/download # Purchased-photo ZIP
    inngest/            # Background-job worker — every function registered here
    health/             # + health/ready (token-gated)
```

### Role-Based System

Two user roles with separate dashboards:
- **PHOTOGRAPHER** (`/dashboard/photographer`) — events, photos, sales, earnings, payout account
- **TALENT** (`/dashboard/talent`) — browse, find and purchase photos, saved photos

**Two columns, two meanings.** `user_role_memberships` is the **capability** (which roles a user
holds); `profiles.active_role` is the **view preference** (which dashboard they last chose).

- ⚠️ **Gate on the membership, never on `active_role`** — the two legitimately diverge. Both dashboard
  layouts filter on `heldRoles` from `getRoleContext()`.
- ⚠️ **There is also an unrelated, EMPTY `user_roles` table** — a false lead that costs a diagnosis;
  no code reads it.
- Role mutation lives entirely in `src/app/[lang]/actions/roles.ts` (initial assignment in
  `completeOnboarding`). ⚠️ Every action there **returns a typed `RoleActionResult` rather than
  throwing** — Next redacts thrown Server Action messages in prod (T-189). Codes and copy:
  `src/lib/role-action-error.ts`.
- **`switchRole` only switches between roles you already hold** (talent's auto-enable is the one
  documented exception) and returns `role_not_held` otherwise — a deliberate invariant pinned by
  `test/integration/actions/roles.test.ts`. Do not "simplify" it away.
- **Gaining a role is a separate, explicit action:** `enablePhotographerRole` / `enableTalentRole`.
  Safe by design; neither touches `admin_users`.
- **The account menus take `heldRoles`** and render «Switch to X» vs «Become a photographer»
  (`dashboard-user-menu.tsx`, `bottom-nav-account.tsx`). Never swallow a switch rejection in a bare
  `catch {}` (T-234).

History: DECISIONS.md §1.

### Key Architectural Patterns

**Server Actions for mutations**
All data mutations use `"use server"` actions in `actions.ts` files colocated next to their page
components. **Do not create new API routes for mutations.** No exceptions remain (T-220). What is left
under `src/app/api/` must be an addressable HTTP endpoint for a reason other than being a mutation:
the Stripe webhook and the Inngest worker (both write heavily, but are called by a third party, not
our UI), image serving, downloads and health.
- ⚠️ **"Not a user-facing mutation" ≠ "read-only":** the webhook creates orders and payouts and moves
  money, and the Inngest route dispatches `retry-pending-payouts`.
- There is **no `api/billing/*`** (deleted in T-202) and **no `api/admin/*`** (T-220). Live billing is
  `dashboard/photographer/billing/actions.ts`. `test/unit/api/dead-billing-routes-removed.test.ts` and
  `test/unit/api/dead-admin-payout-route-removed.test.ts` keep them from coming back.

**Database query layer**
All Supabase queries live in `/src/database/queries/`. Each domain has its own file. Always add new
queries here — never inline in components or actions.

⚠️ **`.single()` / `.maybeSingle()` only when the row count is *guaranteed* (T-235).** PostgREST
answers "0 rows" and ">1 rows" with the same opaque `PGRST116`, which reaches the user as-is. A query
whose absence is an ordinary outcome ("no such event", "not yours", "soft-deleted") must return
**`null`**, so the caller's `if (!x)` branch decides. Prefer `maybeSingle()` for at-most-one, and
`limit(1)` + `data[0]` for pick-any-of-several. Reserve `.throwOnError()` for queries where no row
really is a broken invariant — and note it re-throws *before* any error-mapping branch below it.

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
- Server-side: `src/lib/i18n/get-dictionary.ts`; client-side: `src/lib/i18n/translations-provider.tsx` + `useTranslations()`
- Always add new strings to both dictionaries. Never hardcode visible strings.

**Feature flags**
Controlled in `src/lib/feature-flags.ts`. `AI_MATCHING` is **enabled**. `searchFacesInEvent` re-checks
the flag server-side, so keep both gates in sync.

**Environment validation**
`env.mjs` uses T3 Env (Zod). Always add new environment variables here.

History: DECISIONS.md §2.

## Database Schema

### Key Tables

**events**
`id, user_id, name, date, session_time, session_end_time, city, country, state, activity, is_public, share_code, slug, price_per_photo, bundle_tiers, bundle_all_photos_cents, watermark_enabled, reveal_gate_enabled, cover_path, is_collaborative, allow_guest_upload, require_upload_approval, type, ai_matching_enabled, contains_minors, ai_matching_status, bib_detection_enabled, bib_detection_status, lat, lng, deleted_at, created_at, updated_at`
(canonical shape: the `Event` interface, `src/database/queries/events.ts:8`)
- Soft delete via `deleted_at`
- ⚠️ **`state` is the geographic region** (it pairs with `city`/`country`), NOT a status column.
  `upcoming`/`completed` is **derived from `date`** by `getEventStatus()` (`src/lib/event-status.ts:3`) — nothing is stored
- `type` (`solo`/`collaborative`/`organizer`) + `require_upload_approval` decide whether uploads route
  through a Pending queue — one predicate, `eventUsesModerationQueue` (`src/lib/event-status.ts`). An
  organizer event carries **no price of its own** (`price_per_photo` stored `null`); each contributor
  sells their own photos. ⚠️ **There is no organizer revenue split** (T-219)
- `session_time` (nullable `time`) is the manual session start the photographer types, **display only**
  — naive local time-of-day, unrelated to any camera time-sync (T-106). `session_end_time` (T-180) is
  its mirror; when both are set the UI shows a range via `formatSessionTimeRange`. App-level rule: an
  end requires a start and must be after it (`isValidSessionRange`) — the column carries no constraint
- `share_code` allows access to private events

**Bundle pricing (T-203/T-204/T-212).** A bundle is a **PRICE, not a PRODUCT**: the purchasable unit
stays the photo and a sale still writes one `order_items` row per photo, so every entitlement reader is
untouched.
- **`bundle_tiers`** (nullable `jsonb`) — an ascending ladder of `[{minQuantity, totalPriceCents}]`;
  null = no bundle. **`bundle_all_photos_cents`** (nullable `integer`) — a **CEILING**, not a rung, and
  independent of the ladder ("€5 a photo, or €20 for all of them").
- **Single calc point for a SET:** `getBundlePriceCents(quantity, unitCents, tiers)` in
  `src/lib/bundle-pricing.ts` (client-safe, so the cart displays what checkout charges). The applicable
  rung is the one with the **greatest** `minQuantity ≤ quantity` — ⚠️ **never the cheapest applicable
  rung**, which would let a 20-photo buyer pay the 3-photo price. Then
  `price = min(quantity × unit, rungTotal, cap)`.
- **Single calc point for a CART:** `priceCartWithBundles` (`src/lib/cart-bundle-pricing.ts`), called by
  both checkouts, both cart views (⚠️ **including the authenticated cart's optimistic re-price after a
  removal** — a `reduce` there shows a discount checkout won't honour) and the selection toolbar.
  **Grouping is `(event, photographer)`**, never the whole cart. It **fails closed to list price** when
  the event is ineligible, has no schedule, has no `eventId`, or when a group's lines disagree on the
  unit price.
- **Validated at write time** in both event actions (`validateBundleSchedule`), not by a DB constraint:
  thresholds integer ≥ 2 strictly increasing; totals positive, **strictly increasing with threshold**,
  each ≥ `MIN_PHOTO_PRICE_CENTS` applied to the **rung total** (not per photo) and strictly below
  `minQuantity × price_per_photo`. The cap must be ≥ `MIN_PHOTO_PRICE_CENTS`, **strictly above** the
  unit price and **strictly above every rung total**.
- ⚠️ **The price is NOT monotonic in quantity, and nothing enforces that it is** — that is what a volume
  discount IS. The buyer is protected by the `min` against singles, not by monotonicity.
- ⚠️ **THREE submission states, not two:** `parseBundleTiersSubmission` / `parseAllPhotosSubmission`
  return `absent` (⇒ **don't touch the column**), `cleared` (⇒ write null), `invalid` (⇒ **reject the
  save and name the reason**; never write) or the parsed value. Collapsing them into one `null` is
  silent data loss on a money column. `parseBundleTiers` (READ) still fails **closed** to "no ladder" —
  right for a read, wrong for a write.
- ⚠️ **Only a form that renders the ladder editor may send it:**
  `buildEventUpdateFormData(parsed, { includeBundlePricing })` omits the field otherwise.
- ⚠️ **Write paths gate on `eventAcceptsBundleConfig`, never `eventSupportsBundles`** — the latter folds
  in the kill switch, so flipping `BUNDLE_PRICING_ENABLED` for a rollback would erase every stored
  ladder on the next save of any kind. Rollback must be inert and needs no migration.
- Excluded from **organizer** events (several sellers, no agreed split) and from **free** events — but an
  ineligible event **KEEPS its stored ladder**; restoring a price restores the packs.
- **Display:** the buyer service fee rides on the **post-discount** subtotal everywhere. **Exactly one
  surface quotes an event's price** — with a schedule, `EventPricingSection` (unit price + every package
  + the cap row) and `EventMetaLine` suppresses its price segment; with no schedule the section renders
  nothing and the meta line keeps the price. One-line offer display goes through `getBestBundleOffer` +
  `resolveBundleOfferLabel` (`src/lib/bundle-offer-label.ts`), which picks the **deepest** offer.
  schema.org `offers` = one Offer per rung via `buildEventOffers` (`src/lib/event-offers-json-ld.ts`).
  `event-card.tsx` renders no price.
- ⚠️ **"Add all my photos" takes its ids from the viewer's OWN match set** (`faceSearch.matchedPhotos`),
  **never** a fresh query for the event's photos — on a reveal-gated event that set IS the proven set the
  reveal token was minted over. Pinned by `test/unit/src/app/bundle-add-all-id-source.test.ts`; breaking
  the gate is one call away and both versions compile.

History: DECISIONS.md §3.

**photos** (via `/src/database/queries/photos.ts`)
- `upload_status` (`pending`/`approved`/`rejected`/`failed`) — **galleries render approved only**; owner
  uploads sit `pending` until the Inngest worker validates the bytes and promotes them
- ⚠️ **`failed` ≠ `rejected` (T-231).** `rejected` = bad bytes, worker DELETED the storage object;
  nothing to recover, doesn't count toward the per-event upload cap. `failed` = retries exhausted
  **before a verdict**, bytes still there, photo IS recoverable
- ⚠️ **Never leave such a photo `pending`:** that state is invisible on every surface *and* the reconcile
  cron re-drives it forever. `settleStrandedUploadStatus` (`index-photo-faces.ts`, in `onFailure`) settles
  it, and no-ops when the status is already settled or when `pending` is the *legitimate* moderation
  queue (a third-party upload on an approval-gated event)
- Recovery is an explicit owner decision on the event page — `retryFailedUploadsAction` (re-emits
  `photo.uploaded`, rate-limited 20/h since each photo can trigger billable AWS work) or
  `discardFailedUploadsAction` (hard delete + storage)
- ⚠️ The owner page's grid total is `countEventPhotosByStatus(['approved','pending'])`, **not**
  `countEventPhotos` — the latter is the upload-cap counter, where a `failed` photo's bytes still count
- `face_index_status` (`pending`/`indexing`/`indexed`/`failed`/`no_faces`/`not_applicable`) and
  `thumbnail_status` track the Inngest jobs; `width`/`height` persisted for layout
- Stored in Supabase Storage bucket `photos`; watermarked previews via `/src/app/api/watermark/`; full
  resolution only via short-lived signed URLs after purchase
- **Soft-delete on sale (`deleted_at`, T-142):** a photo that has been SOLD (the `getSoldPhotoIds` /
  `isPhotoSold` predicate over completed `order_items`/`guest_order_items`) is **never hard-deleted**.
  Every delete path (`deletePhotoAction`, `updateEventAction`'s inline delete,
  `deleteContributorPhotoAction`, `deleteEventAction`) checks the sold-set and calls
  `softDeletePhotosByIds` (stamp `deleted_at`, keep row **and** storage object). Unsold photos hard-delete
  + drop storage. The `ON DELETE RESTRICT` FK stays as a backstop; `orders`/`order_items` are never touched
- ⚠️ **Query invariant, both directions.** Every photographer/public/gallery/search/cart/cover/quota read
  filters `deleted_at IS NULL` (a miss resurfaces a deleted photo); buyer-facing reads
  (`getTalentPurchasedPhotos`, `getPurchasedPhotoIdsForEvent`, `getPhotoForDownload`, orders previews,
  guest download-token page) and the orphaned-storage-cleanup **in-use** set must **never** add that
  filter — a stray filter there deletes a paying buyer's bytes. The ZIP route allows a buyer's purchased
  items even after the whole event is soft-deleted

**photo_faces** (via `/src/database/queries/rekognition.ts`)
`photo_id, aws_face_id, aws_collection_id, confidence, bounding_box, indexed_at`
- One row per face AWS Rekognition indexes; unique on `(photo_id, aws_face_id)`
- Embeddings live inside the AWS collection — the DB only stores the returned `aws_face_id`

**carts / cart_items**
`carts: id, user_id` — `cart_items: id, cart_id, photo_id, photographer_id, unit_price_cents, allocated_price_cents, access_share_code`
- Guest cart in `localStorage` under `photo-markt_guest_cart`; merged on login via `src/components/guest-cart-merge.tsx`
- ⚠️ **The guest cart is shared state between tabs (T-223).** `GuestCartProvider` listens for `storage` and
  adopts what another tab wrote — without it two tabs diverge and the next write from the stale one clobbers
  the other's cart wholesale, since each serializes its own array over the one key. **Every read of the
  stored value goes through `parseGuestCart` (`src/lib/guest-cart.ts`)**, which fails closed to an empty
  cart: the value is user-writable, and one entry without a numeric `unitPriceCents` turns `subtotalCents`
  into `NaN`. The listener must never touch `hydrated` — consumers treat an empty cart as real only once it
  is true (T-176)
- **`allocated_price_cents` (T-204) — the COMMITTED bundle allocation.** The discounted total is split
  across the photos exactly (`allocateBundleTotalCents`, largest remainder) and written **before** the
  Stripe session is created. ⚠️ **The webhook READS it (`allocated_price_cents ?? unit_price_cents`) and
  never recomputes a bundle price from the event's tiers** — the ladder is editable at any moment.
  Writing it **clears every other row in the cart first**. Null ⇒ list price (pre-bundle behaviour), so
  only discounted groups are written and rollback needs no migration. The guest flow commits the same
  allocation in the `c` field of its `cart_<i>` metadata
- `access_share_code` (T-134) persists the private-event share code the buyer presented at add/merge
  time — the access proof authenticated checkout re-validates. Both `createCheckoutSessionAction` and the
  `getCurrentCart` self-heal drop/refuse an item unless its event is public now, its stored
  `access_share_code` still matches the event's `share_code`, or the buyer still has the photo tagged
  (live check). Stored null for public events and the favorites/tag path; legacy rows (null) fail closed
- ⚠️ **Access proof is per-item and validated live.** Never treat the display-only `event_share_code` (the
  event's *current* code, joined for the `/events/[shareCode]` link) as the proof. The shared
  accessibility rule is `isEventAccessible` / `getAccessibleAuthedCartPhotoIds` — reuse, don't re-derive

**orders / order_items**
`orders: id, user_id, cart_id, stripe_payment_intent_id, stripe_checkout_session_id, status, total_amount_cents`
- Status: `pending`, `completed`, `failed`, `refunded`, `disputed`
- Both `orders` and `guest_orders` also carry `withdrawal_consent_at` / `withdrawal_consent_version`

**payment_accounts** — **DROPPED (T-219).** Superseded by Stripe Connect, whose account id + status live
on `profiles.stripe_connect_account_id` / `profiles.stripe_connect_status`. `payouts.payment_account_id`
went with it; `test/unit/database/dead-schema-pruned.test.ts` keeps them from coming back.

**payouts** — the ledger of money owed to photographers. Columns and every rule that governs it are in
[The money path](#the-money-path--payouts-orders-clawbacks) below.

**ai_search_profiles** — **DROPPED (T-219)**, along with `ai_search_usage`, `time_sync_tokens`,
`upload_batches`, `upload_objects` and the `vector` extension. Face matching is AWS Rekognition: selfies
are sent per search and never stored, and the live per-event gating fields (`ai_matching_enabled`,
`contains_minors`, `rekognition_collection_id`, `rekognition_region`, `ai_matching_status`) are on
**`events`**.

**admin_users**
`user_id, granted_at, granted_by`
- Service-role-only (RLS enabled, no policies). Look up via `supabaseAdmin`, never the user-scoped client
- Gates the admin service-status page (`[lang]/dashboard/admin/status/page.tsx`) — the only admin-gated
  surface left since T-220 removed `/api/admin/*`
- Seed admins via direct DB access: `insert into admin_users (user_id) values ('<uuid>')`

**rate_limit_buckets**
`bucket_key, window_start, count`
- Service-role-only (RLS enabled, no policies). Backs `src/lib/rate-limit.ts`. Atomic increments via the
  `increment_rate_limit_bucket` `SECURITY DEFINER` function — EXECUTE explicitly revoked from `anon` and
  `authenticated`. One row per `(bucket_key, window_start)`; no automatic cleanup yet

## The money path — `payouts`, orders, clawbacks

`payouts`: `id, photographer_id, amount_cents, status, admin_notes, stripe_transfer_id, stripe_charge_id,
currency, hold_reason, order_id, order_kind, transfer_batch_id, reversed_amount_cents, stripe_reversal_id,
reversed_at, void_reason, frozen_by_dispute_id, paid_at`
(canonical shape: the `Payout` interface, `src/database/queries/payouts.ts:43`)

Flows: `ARCHITECTURE.md` §4.3. **Every rule below is the residue of a sale that lost money — read
DECISIONS.md §5 before changing anything here.**

### Transfers

Transfers fire **per order**, synchronously in the Stripe webhook (one per `(order_item, photographer)`).
The **retry cron** (`retry-pending-payouts`, `10,40 * * * *`) drains what that path could not send — a
recovery path, not the normal one.

- ⚠️ **The row is created BEFORE the Stripe call and its id IS the idempotency key** (`payout_<row.id>`),
  in the webhook and the retry worker alike. Reverse the order and redeliveries double-pay (T-216).
- ⚠️ **The parameters must match too:** Stripe compares the *whole request body* against the one stored under
  a key and 400s on divergence. `transfer_group` comes from `payoutTransferGroup(row.id)` in **both**
  writers, never from the order id.
- That ordering is what makes the partial unique index on **`(stripe_charge_id, photographer_id)`** *prevent*
  a second payment rather than merely record one. `UNIQUE(stripe_transfer_id)` is **gone** (one aggregated
  transfer settles N rows).
- **Three exits must never lose money silently** — Connect not active, net < 50¢, `createTransfer` threw.
  Each writes a `pending` row with a `hold_reason` (`connect_inactive` / `below_minimum` /
  `transfer_failed`). `processing` = a Stripe call is in flight.
- **Only sub-50¢ rows are batched** (`splitPayableRows`, `src/lib/payouts/batching.ts`). Anything clearing
  the minimum transfers individually **with `source_transaction`** — it guarantees funding and lets Stripe
  refuse an over-draw, a double-pay guard that never expires unlike the 24h key. Batches group
  `(photographer, currency)`, drop `source_transaction` and draw on the *platform* balance.
- ⚠️ **The retry worker only considers rows with BOTH `hold_reason` and `stripe_charge_id` set.** That is a
  security filter, not an optimisation.
- **`payouts` is photographer-read / service-role-write** — no INSERT or pending→cancelled UPDATE policy
  (dropped in `20260807000000`), no `createPayout` helper (T-220). Pinned by
  `test/integration/security/payouts-rls.test.ts`.
- ⚠️ **Three writers touch a payout row, not two:** the webhook's transfer path, the retry worker, and the
  clawback path (`applyReversalToHolds` on `charge.refunded`; `freezeHoldsForCharge` /
  `restoreHoldsForCharge` on a dispute) — the only one that can void a hold.
- ⚠️ **Not every hold self-heals, and `report-stuck-holds` (T-254) is the visibility for those.** The
  worker's failure exits deliberately never throw, so it raises `payout-hold-stuck` — one aggregated
  incident, claimed once per rolling day — for rows outstanding beyond their window: **24 h** for
  `pending`/`transfer_failed` or any `processing` row (the worker itself is wedged — transfer throwing
  every pass, probe `unknown` forever, no Connect destination), **30 days** for
  `connect_inactive`/`below_minimum` (legitimate states short-term; recorded money nothing will move
  after a month). The clock is **`created_at`** — `updated_at` re-stamps on every failed retry — and
  frozen rows are excluded (T-265 owns those). ⚠️ **It runs AFTER the transfers, at BOTH exits** — one
  function, two call sites: after the paying steps, so a row this pass pays is never named as stranded
  (a `transfer_failed` hold whose photographer just onboarded, or one step 0b released from a stale
  claim, is older than the window and paid moments later), **and** on the nothing-payable early return,
  which is the sharpest stranding there is. **Reports, never repairs**, and the alert never instructs a
  manual transfer (T-249/T-255 rule). Amounts are quoted **per currency** — `payouts.currency` is per
  row and one summed figure means nothing.
- ⚠️ **That sweep swallows its read errors *because* it runs before the paying steps — so it alerts
  `payout-hold-sweep-failed` from the `catch`.** Swallowing makes the step *succeed*, so a wedged query
  would otherwise silence the watchdog permanently with nothing red in Inngest either (T-255 gets this
  from an `onFailure`; this one cannot, since it never throws). Its row caps are read at **`limit + 1`**
  and the overflow travels as `countsTruncatedAtRows` — a silently capped count reads as "this is everything",
  which is how a mass failure looks small.
- **There is no admin payout endpoint (T-220), and re-adding one is not a fix:** a status flip moves no
  money, and cancelling a hold by hand makes it permanently unpayable.

### Held sales — telling the photographer

- **Only a `connect_inactive` hold emails the photographer** (T-250); the other two hold reasons drain on
  their own.
- ⚠️ **Send only when the row just opened is the ONLY outstanding `connect_inactive` hold**
  (`countOutstandingConnectInactiveHolds` === 1) — 40 sold photos are one email, not 40. DB-derived on
  purpose; self-resetting.
- The amount quoted is `getTotalPendingPayouts` — the same query behind the dashboard and Earnings alerts.
- `notifyPhotographerOfHeldSale` (`src/lib/payouts/notify-held-sale.ts`) **never throws**; the webhook bounds
  it with `EMAIL_TIMEOUT_MS`. ⚠️ **Do not merge it with `reportMoneyIncident`** — that alerts **us** about a
  failure, this tells the **photographer** about a normal state.

### Order status

- ⚠️ **`completed` is written by two flows with DISJOINT allow-lists, and they must stay disjoint (T-259).**
  `mayWriteOrderStatus` (clawback flow, status recomputed from Stripe's facts): `completed` may only undo a
  revocation this flow itself made (`refunded` / `disputed`). `mayPromoteOnPaymentSuccess`
  (`payment_intent.succeeded`): legitimate from `pending`/`processing`/`failed`, **never** from a reversal.
  Stripe redelivers for up to three days, and 13+ read paths gate on `status = 'completed'`.
- **`disputed` revokes access everywhere with zero reader changes**, and `won` sets it back — the
  exactly-once index constrains **INSERTs, not UPDATEs**, so the row never went away.
- ⚠️ **Dispute and refund handling must touch `guest_orders` too** (`getGuestOrderByPaymentIntentId`).

### Clawbacks (T-215, absorbing T-237)

`applyClawback` (`src/lib/payouts/apply-clawback.ts`) is the **ONE path** used by both `charge.refunded` and
`charge.dispute.closed` (lost), so the two can't drift. `charge.dispute.created` flips **`orders` and
`guest_orders`** to `disputed`.

- An outstanding hold is **reduced proportionally** (`applyReversalToHolds`, `pending` rows only), voided
  only on a **full** reversal. A transfer already sent is reversed at Stripe and recorded
  (`reversed_amount_cents`, `stripe_reversal_id`, status `reversed` once nothing is left). A refund never
  un-sends a transfer.
- Pure math in `src/lib/payouts/clawback.ts`, **all integer cents** — a float ratio leaves a phantom cent.
- ⚠️ **The reversal idempotency key is `(payout row, CUMULATIVE reversed amount)`, never
  `(transfer, charge)`** — that pair is constant across successive partial refunds, so the second would reuse
  the first's key and Stripe would return the first reversal.
- ⚠️ **Nothing on this path throws** (a 500 makes Stripe redeliver a *money* operation): failures become
  `reportMoneyIncident` alerts and rows left for reconciliation. **There is no separate clawback email
  channel.**
- A `processing` row is **probed** with `findTransferByGroup` first; `unknown` means do nothing.
- ⚠️ **`reservePayoutReversal` / `releasePayoutReversal` do their arithmetic in ONE SQL statement**
  (migration `20260828000000`, service-role only) — **never** read-modify-write from JS (T-260). The
  `least`/`greatest` clamps live in SQL *because* that is what keeps it one statement.
- A lost dispute's ~€15 fee is a **platform** cost, never charged to the photographer. ⚠️ **A won dispute
  un-voids exactly the holds THAT dispute froze, scoped by `frozen_by_dispute_id`** — scoping on
  `void_reason` alone resurrected holds a real refund had voided, paying the photographer for a sale the
  buyer got back.
- ⚠️ **A freeze is a MARK, not a status, and one failed unfreeze strands the row forever (T-265).**
  `listPayableHolds` refuses every row carrying `frozen_by_dispute_id`, and `restoreHoldsForCharge` —
  reachable only from `charge.dispute.closed` — is its only writer. Both `catch` blocks therefore
  alert (`dispute-freeze-failed` when the freeze fails, so the cron may pay a disputed charge;
  `dispute-unfreeze-failed` when the release fails, so the money is unpayable) — **still no throw, no
  status change, same 200**.
- ⚠️ **A failed FREEZE has no automatic recovery — the alert is it.** The row carries no mark, so the
  sweep below cannot find it either, and nothing guarantees a later `charge.dispute.updated` (a
  dispute can go straight from `needs_response` to `closed`).
- ⚠️ **`release-stale-dispute-freezes` (in `retry-pending-payouts`) is the ONLY exit for a stranded
  freeze, and it REPAIRS where the reversal sweep does not (T-265).** It asks Stripe per dispute
  (`disputes.retrieve` — by id, conclusive, unlike `findTransferByGroup`) and **releases only what is
  unambiguous**. Four refusals, each of which pays real money if dropped:
  - **`open`** — a chargeback runs for 60–90 days. Not stuck, not news.
  - **`lost`** — never restored. But the **mark is cleared** on rows the clawback already settled
    (not `pending`, or `pending` with `reversed_amount_cents > 0`), because otherwise the set never
    drains: those rows are never updated again, so they sit at the head of the sweep's
    `updated_at ASC` window forever, hiding genuinely stranded freezes behind the row cap and costing
    a Stripe read per pass. A `pending` row with nothing reversed means the clawback never ran —
    reported, never cleared.
  - ⚠️ **any refund on the charge** — a chargeback freeze leaves the row `cancelled`, which **both**
    clawback selectors skip (`applyReversalToHolds` takes `pending`, `listReversibleRowsForCharge`
    takes `paid`/`processing`/`reversed`), so a refund landing while it is frozen records **nothing**
    on it. Releasing would hand back the FULL amount for a refunded sale. The webhook solves this by
    following its restore with `applyClawback({ reason: 'refund' })`; the sweep refuses instead, so a
    cron never moves money.
  - ⚠️ **an order still `disputed`** — that sale is out of the photographer's `net` and the buyer is
    locked out, so paying breaks "a hold sits in `pending` exactly while its sale sits in `net`".
    Restoring access is the webhook's job, not a cron's.
  A failed or missing read is **never** a verdict. Everything unresolved is reported once a day under
  `dispute-freeze-stuck`, and the Stripe reads are bounded per pass with the overflow named in the
  alert (`deferredDisputes`) rather than dropped silently.

### Driving the transfers, and the silent failures

⚠️ **The ledger's `try/catch` + `continue` is correct, and that is exactly why it must alert (T-249)** — the
failure is invisible by construction unless something surfaces it. **Every exit that can complete an order
without paying calls `reportMoneyIncident`** (`src/lib/observability/report-money-incident.ts`,
`kind: 'payout-not-recorded'`); there are seven, enumerated in DECISIONS.md §5 — check that list before
adding an early return to this path.

- ⚠️ **No alert here may claim nothing was paid.** `createTransfersForOrderItems` can throw part-way through a
  multi-photographer cart *after* earlier photographers were paid; name the `payouts` rows as the authority instead.
- ⚠️ **BOTH payment events drive the transfers (T-252)** — Stripe does not guarantee ordering.
  `checkout.session.completed` and `payment_intent.succeeded` both call the shared **`drivePayoutsForOrder`**;
  whichever arrives first pays, the second no-ops because `openPayoutRow` reserves the row **before** the
  Stripe call. **Re-driving is only safe because of that ordering.**
- ⚠️ **Only the delivery that CREATES the order drives its payouts.** A redelivery whose order already exists
  stops at the guard: the unique index is partial (`where stripe_charge_id is not null`) and every pre-T-216
  row has a null charge id, so resending an old session would open a fresh row under a new key and **pay
  twice**. Pinned by the redelivery test in `test/integration/api/stripe-webhook.test.ts`.
- ⚠️ **T-262 narrows that guard by exactly one case:** an order with **no `order_items`** was never assembled,
  has no payout rows to pay twice, and is resumed. The distinction is **`orderHasItems`**, never
  `existingOrder.status` — the row is written `completed` from the start.
- ⚠️ **`createAuthenticatedOrder` distinguishes a failed READ from an absent ROW, and reports both (T-262).**
  A read error alerts and **throws** (the 500 is the retry); a missing row alerts and gives up. Assembly
  (`addOrderItems` + `clearCart`) is wrapped the same way.
- An authenticated session that is `unpaid` (delayed payment method) or `no_payment_required` **skips the
  drive**; any other/absent `payment_status` falls through and *attempts* the transfer (Stripe refuses a
  premature one and it parks as a recoverable `transfer_failed` hold, while skipping it would be silence).
  ⚠️ The **guest** branch has no such check and no second driver — it recovers through its own redelivery.
- ⚠️ **A guest order is born `pending`; only `completeGuestOrder` marks it delivered, and the exists-guard
  breaks ONLY on `completed` (T-261).** The redelivery resumes the same row (guarded by `guestOrderHasItems`)
  and the failure reports **before rethrowing** — the rethrow is *wanted*, the 500 triggers the retry that
  fixes it. **Do not "tidy" the guard back to `if (existingGuestOrder)`, and do not make the assembly
  non-throwing.**
- ⚠️ **`completeGuestOrder` is the LAST thing the guest branch does, after the transfers (T-263)** —
  `completed` is what stops a redelivery from resuming, so anything after it is unprotected. Pinned by a test
  asserting `openPayoutRow` runs before it. `maxDuration = 60` raises the ceiling but does not remove it. The
  buyer is not held hostage: the download page reads `getGuestOrderWithItems`, which does **not** filter on
  status.
- **Every incident raised inside the shared drive carries `source`** — a genuine failure alerts once per
  delivery, from two invocations no per-process throttle can dedupe.
- **The buyer's confirmation email sits *before* the money moves and is bounded (5 s)** — Stripe treats a
  slow response as a failed delivery.
- ⚠️ **A `payment_intent.succeeded` with no order is reported NOWHERE, on purpose** — subscriptions carry an
  `invoice`, guest payments live in `guest_orders`, and the out-of-order case is covered by the other
  handler. Alerting would bury the signal.

### `reportMoneyIncident` and the recovery sweeps

The reporter changes **nothing** about the flow: same `continue`, same 200. Two absolutes: it **never
throws**, and it **never carries buyer PII** (ids and amounts only; `sendDefaultPii: false` globally).
Channels: `console.error` + Sentry always (fingerprinted on `kind`), plus an ops email when
`MONEY_ALERT_EMAIL` is set.

- Only the **email** is throttled (per-process 60 s), keyed **per `kind`** (a payout alert must not silence a
  dispute alert) and **released when the send fails**. Bounded by 5 s — it rides inside the webhook.
- ⚠️ **Every recovery sweep gets its OWN `MoneyIncidentKind` — never a shared `needs-reconciliation`**
  (T-264, binding on T-254/T-255/T-265). Fingerprint and throttle are both keyed on `kind`, so sharing one
  collapses distinct problems into one issue and lets the first firing silence the rest.
  `needs-reconciliation` stays reserved for the clawback path that declares it.
- ⚠️ **A sweep alerts about a STATE, not about a pass, and the cron runs 48×/day.**
  `report-unconfirmed-reversals` (`retry-pending-payouts.ts`) is the reference shape: **one aggregated
  incident** for the whole set (count + oldest + a bounded id list), claimed once per rolling day through
  `rateLimit` (`money-alert:<kind>`, `limit: 1`, 24 h) — Postgres-backed, so it holds across invocations.
  `rateLimit` fails **open**.
- ⚠️ **`listUnconfirmedReversals` must filter `status in ('paid','reversed')` (T-264)** — a hold stamped
  `reversed_at` by `applyReversalToHolds` will never carry a `stripe_reversal_id`, so without the filter it
  matches forever. That sweep **reports and does not repair**, deliberately.
- ⚠️ **`reconcile-order-payouts` (T-255, cron `25,55`) is the only alert that asks the RESULTING ROWS**
  instead of the code path — every other producer fires as the webhook walks past a known exit, so an
  eighth exit is silent by construction. It reports a paid order (`total_amount_cents > 0`) past a
  **6 h grace**, inside a **30-day lookback**, with **no** `payouts` row for its `(order_id, order_kind)`
  — kind `order-without-payouts`, aggregated, claimed once a day. Covers `orders` **and** `guest_orders`.
  **Reports, never repairs**: a cron moves no money (same line T-265 draws).
  - ⚠️ **The alert must never tell anyone to transfer by hand.** Zero rows proves nothing was paid
    *yet*, not that nothing is *about to be*: Stripe redelivers for up to three days and T-262's
    itemless order is resumed by exactly that redelivery, so a manual transfer on top is a double
    payment. Name the ledger as the authority — same rule as T-249.
  - ⚠️ **Guest orders are swept in `pending` too, not just `completed`.** A `guest_orders` row only
    exists once Stripe reported the session complete, and `completeGuestOrder` runs **last** (T-263) —
    so a `pending` guest order past the grace IS the T-261/T-263 kill, and **nothing else selects it**
    (buyer reads gate on `completed`; the retry worker needs a payout row that was never opened).
  - ⚠️ **The authenticated side MUST probe the PaymentIntent; a `completed` guest order must NOT.**
    `orders` is written `completed` *before* the payment is confirmed, so an `unpaid` session (delayed
    method, e.g. SEPA) is a legitimate zero-payout order for days; only `succeeded` is a verdict, and a
    failed/missing read is never one (`retrievePaymentSettlement`, `src/lib/stripe/payment-intents.ts`).
    A guest order reaching `completed` is already conclusive.
  - ⚠️ **An unverifiable candidate is still reported** (as `unverifiableOrderIds`, never as settled
    debt). Exiting quietly when every probe fails is how a Stripe outage turns the sweep off for good.
  - ⚠️ **The window is PAGED, not `LIMIT`-ed, and the probe cap ROTATES.** A bare limit on
    `created_at ASC` pins the sweep to the oldest N orders — all healthy — so a break last week is never
    examined once volume grows; an unrotated probe cap starves candidate N+1 forever, because the list
    is rebuilt identically each pass and nothing is repaired.
  - ⚠️ **Every completeness counter is computed OUTSIDE the `step.run` bodies.** On an Inngest replay a
    completed step returns memoized output without re-running its closure, so a counter mutated in-step
    reads 0 in production — and these fields exist to stop the alert claiming it saw everything.
    `retry-pending-payouts.ts` documents the same rule; a pass-through test step cannot catch a breach.
  - ⚠️ **Both order queries project explicit columns, never `select('*')`** — `guest_orders.guest_email`
    is buyer PII and every row here ends in an alert. `listOrderIdsWithPayouts` **pages** its lookup:
    PostgREST truncates at `max_rows` (1000) **without an error**, and a truncated answer there reads as
    "this order has no payout rows" — inventing a money incident. `order_kind` is not optional in the
    anti-join: the two tables have independent uuid spaces (no FK, T-216).
  - **Scope boundaries, deliberate:** it does not see a **partially**-paid order (existence-only
    anti-join; the partial case alerts from `createTransfersForOrderItems`), nor an exit that never
    created an order row at all. `payout-reconciliation-failed` (its `onFailure`) is what surfaces the
    sweep being down — otherwise a failed run shows only in the Inngest dashboard.
- **`purchase-email-not-delivered` (T-253)** is the second live kind: the **guest** delivery email is the
  *product*, yet the send must stay non-fatal — hence the alert. Context is ids only: **never the buyer's
  address (PII), never the download token** (a bearer credential). `subsystem: 'delivery'`.
## Payments

### Photographer Subscriptions
**Free** (8% commission) · **Starter** €9.99/mo (4%) · **Pro** €29.99/mo (0%). Price IDs:
`STRIPE_PRICE_AMATEUR`, `STRIPE_PRICE_PRO`. Managed in `/dashboard/photographer/settings/billing`;
**there is no Stripe billing portal** — that page is the only route back to Free.
`PLANS[].salesFeePercent` (`src/lib/plans.ts`) is the single source of truth (`PLATFORM_FEE_RATES` derives
from it; `test/unit/lib/pricing-consistency.test.ts` fails if the copy drifts).
⚠️ **Pro at 0% is only solvent while the buyer service fee is live** (T-194/T-196).

### Subscription cancellation (T-214)
Cancelling is **`cancel_at_period_end`**, never immediate termination;
`customer.subscription.deleted` then flips `status` to `canceled` and `getCurrentPlan` falls back to Free.
No refund logic anywhere.
- ⚠️ **`subscriptions.cancel_at_period_end` is written by the WEBHOOK ONLY.** `cancelSubscriptionAction` /
  `reactivateSubscriptionAction` call Stripe and write **nothing** — pinned by
  `test/unit/actions/subscription-cancel.test.ts`, which makes both Supabase clients' `from()` throw.
- **Read it through `hasPendingCancellation(sub)`**, never the flag alone: "pending" needs the flag **and** an
  active-equivalent status. `.deleted` also clears the flag.
- **The undo action is `reactivate`, not `resume`** — `billing/resume/` already means "resume the *checkout*
  intent after signup/login".
- **A plan change clears the flag** (`createBillingCheckoutAction`'s in-place `updated` branch).
- ⚠️ **The webhook revalidates `dashboard-photographer-<userId>` on every subscription write** —
  `getCachedDashboardData` resolves the plan inside a `'use cache'`/`cacheLife('minutes')`, so without it a
  downgrade stays invisible. **Any new cached surface reading the plan must be invalidated there too.**
- **The downgrade is contention, never destruction:** Free's limits live only in the write gates
  (`assertCanUploadPhoto` / `assertCanCreateEvent`). The confirmation discloses that only when the
  photographer already exceeds a Free cap (`getFreePlanOverage`, `src/lib/plan-limits.ts`).
- **Feedback is a direct toast, not a `?status=` code** — those are for *redirect* returns, and
  `status=cancelled` already means *checkout abandoned*.
- ⚠️ **A row can outlive its Stripe subscription**, and Stripe then answers `resource_missing` **forever**.
  `isStripeResourceMissing` (`src/lib/stripe/resource-missing.ts`) separates "stale reference, recover" from
  "Stripe is having a bad minute, retry": the plan change **falls through to a fresh checkout** (minting a
  replacement customer if needed), cancel/reactivate return the distinct `subscription_missing` code.
  **Recovery writes nothing locally.**
- **Not every plan change is an "upgrade":** `isPlanUpgrade` (`src/lib/plans.ts`, ranked off `PLANS` order,
  pinned by `test/unit/plans.test.ts`) picks `upgradeToPlan` vs `switchToPlan`; the copy is resolved in
  `settings/billing/page.tsx`, the only place that knows both the current plan and the dictionary.
  `UpgradePlanButton` takes a finished `ctaLabel`.

### ⚠️ Testing subscriptions locally requires the Stripe CLI
Activation is webhook-only by design, so on `localhost` **nothing activates** unless a listener forwards
events. The symptom is silent: checkout succeeds, Stripe shows `active`, and the app still says Free because
`subscriptions` is stuck on the `incomplete` bootstrap row (not in `ACTIVE_SUBSCRIPTION_STATUSES`).

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints its OWN whsec_…
# put that whsec_… in .env.local as STRIPE_WEBHOOK_SECRET, then restart pnpm dev
stripe events resend <evt_id>   # replay an event that fired while nothing was listening
```

The CLI's `whsec_` is **not** the dashboard's — a mismatch fails signature verification with a 400 and the
webhook stays dead just as silently. Same for Connect payouts and one-time purchases.

### Buyer service fee (billing v2 — T-194/T-195/T-196/T-197)
The buyer pays a **fixed + percent** fee on top of the cart subtotal, as its own visible Stripe line item.
- ⚠️ **Single calc point:** `getBuyerServiceFeeCents(subtotalCents)` in `src/lib/plans.ts`
  (`FIXED + round(subtotal × BPS / 10000)`; non-positive subtotal ⇒ 0). **No checkout, cart or earnings path
  may re-derive it inline** — displayed and charged must come from here. Client-safe.
- **Plain constants, deliberately NOT env vars:** `BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`,
  `MIN_PHOTO_PRICE_CENTS`. **Live since T-199: €0.25 + 3%, floor €1.50.** Setting all three to **0**
  reproduces pre-v2 behaviour exactly — that is the rollback. `computeBuyerServiceFeeCents` is the pure
  kernel tests use for other values.
- **Charged as its own Stripe line item**, never folded into a photo's price, via the shared
  `buildServiceFeeLineItem` (`src/lib/stripe/service-fee-line-item.ts`) in **both** checkouts. It rides on the **server-validated** subtotal — never a
  client figure — and returns `null` at fee 0.
- **Displayed by the shared `CartTotals`** (`src/components/cart-totals.tsx`) at all four render sites; at
  fee 0 it renders exactly the single subtotal row it replaced.
- ⚠️ **The webhook is deliberately untouched:** orders/`order_items` and the photographer transfer are
  rebuilt from cart metadata (guest) and `cart_items` rows (authed), **never** from `session.line_items`, so
  the fee never inflates a photographer's gross. Consequence: `orders.total_amount_cents` is photo-only while
  `orders.metadata.amount_total` is photos + fee. ⚠️ **Count photos with `metadata.cart_count`, never the
  line-item count** (T-196).
- **Photographer earnings never include the fee.** ⚠️ `calculatePlatformFee` (`queries/earnings.ts`) derives
  the commission as **`gross − getPhotographerNetCents(gross)`**, never `round(gross × rate)`, so
  `gross = commission + net` holds by construction. Both Sales and Earnings tabs call the **same**
  `calculatePlatformFee`/`calculateNetEarnings` per line item (T-205). `<BuyerFeeNote>` (`src/components/buyer-fee-note.tsx`) states this on both
  and renders **nothing** while `isBuyerServiceFeeEnabled()` is false.
- ⚠️ **Earnings TOTALS are netted per order, not per period (T-205)** — `aggregateEarningsByOrder` sums
  `getPhotographerNetCents(orderGross)` per order because that is the unit the money moves in; a sum of
  floors is not the floor of a sum. The per-**row** breakdown stays per line item, so a multi-item order's
  rows can sum to a cent under its payout — a display artefact, not a discrepancy.
- **A bundled sale reports the CHARGED amount as gross** (`order_items.total_price_cents` carries the
  allocated share). `<BundleDiscountNote>` (`src/components/bundle-discount-note.tsx`) says so on both tabs and renders nothing unless
  `hasBundlePricingConfigured` (`queries/events.ts`, **fails closed** on error) finds a ladder or cap.
- **`MIN_PHOTO_PRICE_CENTS` is enforced at write time** in both event actions via `isPhotoPriceAboveFloor`,
  **not** as a DB constraint — an event priced below a later-raised floor keeps working until its price is
  next written. Free events (`null`/0) are exempt; a floor of 0 disables the rule. The rejection travels as
  the parseable sentinel `MIN_PHOTO_PRICE:<cents>` (`src/lib/min-photo-price.ts`) because server actions have
  no dictionary. ⚠️ Next redacts thrown Server Action messages in prod (T-189), so the localized copy only
  renders reliably in dev — same caveat as `PlanLimitError`.

History: DECISIONS.md §6.

### Photo Purchases (Talent)
One-time Stripe payments; webhook at `/src/app/api/stripe/webhook/route.ts`. After confirmed payment: order
saved, cart cleared, photos available in talent profile and orders.

### Right-of-withdrawal consent (T-228)
Directive 2011/83/EU art. 16(m) (Spain: art. 103.m TRLGDCU) exempts digital content from the 14-day right of
withdrawal **only** with the buyer's prior express consent to begin delivery **plus** their explicit
acknowledgement that this loses the right. A Terms clause achieves nothing — consumer law is mandatory and
cannot be waived by contract — so consent is collected per purchase and stored as evidence.
- **Single source of truth: `src/lib/withdrawal-consent.ts`** (client-safe). The browser sends only a
  **boolean**; timestamp and `WITHDRAWAL_CONSENT_VERSION` are stamped **server-side**.
- ⚠️ **Bump `WITHDRAWAL_CONSENT_VERSION` whenever `cart.withdrawalConsentLabel` changes in either
  dictionary** — in a dispute the question is *which sentence* was ticked, and the order row is the answer.
- ⚠️ **The gate is the server, not the checkbox.** Both actions take consent as a **required** parameter
  (`createGuestCheckoutSessionAction(items, accepted)` / `createCheckoutSessionAction(accepted)`) so the
  typecheck catches a forgetful call site, and return `consent_required` **before the rate limiter and before
  any DB/Stripe work**. The disabled button is UX only. No carve-out for free carts.
- **Transport is Stripe session metadata** (`wd_consent_at` / `wd_consent_version`) — same mechanism as the
  guest cart's `cart_<i>`, so there is no window where a session exists but its consent does not.
- **Persisted on `orders` AND `guest_orders`** (migration `20260805000000`, both nullable).
  ⚠️ `createOrder`/`createGuestOrder` build their insert from a **literal, not a spread** — a field not listed
  there is dropped silently.
- **The webhook fails OPEN** (no consent in metadata ⇒ order still created with NULL columns): the buyer has
  already paid. `parseWithdrawalConsentMetadata` itself fails **closed** to `null` — null must never read as
  "assume consent".
- **Art. 8.7 needs the confirmation email**, which is why `sendPurchaseConfirmationEmail` exists at all. Both
  templates share `withdrawalConsentEmailBlock`; both are English-only.

### Sending email (T-253)
⚠️ **`resend.emails.send` resolves `{ data, error }` — it does NOT throw on an API error.** An invalid key, an
unverified sender domain, a rate limit or a malformed `to` all come back as a *resolved* promise, so a caller
that discards the result reports success for a message that was never sent.
- **Every send goes through `sendEmail` (`src/lib/email/send-email.ts`)**, which checks `error` and throws
  `EmailDeliveryError`; it owns the lazily-constructed Resend client and the single `EMAIL_FROM`.
  **Never call `resend.emails.send` directly** — that is how the check gets forgotten again.
- **Only the chrome is shared** (`src/lib/email/layout.ts`): `renderTransactionalEmail` (buyer card),
  `renderOpsAlertEmail` (bare), `escapeHtml`. The **messages** stay per sender on purpose.
- **`escapeHtml` is applied to event names** in both buyer templates — photographer-typed text in
  hand-assembled HTML.
- ⚠️ **`renderTransactionalEmail` takes its footnote as a required argument** (T-250) — a default is how the
  buyer wording ships on a photographer email unnoticed. `BUYER_FOOTNOTE` is shared by the two receipts.
- **All templates are English-only** (`profiles` stores no language preference). The held-sale CTA link
  therefore carries **no locale segment** — `src/proxy.ts` resolves one from the reader's own cookie /
  `Accept-Language`.

History: DECISIONS.md §7.

### Photographer Payouts (Stripe Connect)
- Photographers connect Stripe Express accounts in `/dashboard/photographer/settings/payout-profile/`
- Photo Markt absorbs the Stripe Connect fee (0.5%) — the photographer always receives exactly their promised
  net amount
- Sales and earnings share one tabbed page at `/dashboard/photographer/sales/` (`?tab=earnings`); `/ventas`,
  `/ganancias`, `/earnings` are redirect aliases
- ⚠️ **NEITHER CHECKOUT LOOKS AT CONNECT STATUS (T-248). Do not re-add that gate.** Selling and being able to
  receive the money are separate readiness states: a photographer may publish, price and sell before
  finishing onboarding, and the webhook records their net as a `connect_inactive` hold that
  `retry-pending-payouts` drains once `account.updated` reports the account active. The
  `photographer_not_connected` code is **deleted, not unused**. The buyer is deliberately told **nothing**
  about the photographer's payout state.
- **The photographer is warned instead, in proportion to what is at stake.** One decision point,
  `src/lib/payouts/payout-readiness.ts`: `resolvePayoutReadiness` returns `money_held` (⚠️ **red — earnings
  are actually stuck**; `heldCents` from `getTotalPendingPayouts`, the same query behind the Earnings alert),
  `sales_will_hold` (amber — priced events but nothing sold yet; a forecast in red trains people to ignore
  red), `setup_pending` (amber), or `null`. `eventEarningsWillBeHeld` is the one-event variant behind the
  notice the event page renders **above its tabs**, so it doesn't depend on which tab is open. Free events are
  exempt. ⚠️ **The warning surfaces (not the checkouts) read the status through
  `reconcileAndPersistConnectStatus`, never the raw column** — a stale `pending` would tell a working account
  its money is stuck.
## Shared Components

```
src/components/
  ui/
    photo-action-icon.tsx     # Shared photo action icon (dark bg, white icon, tooltip)
    location-autocomplete.tsx # Google Places autocomplete for event forms only
  event-search-bar/           # Search bar with filter modal (Airbnb-style)
  photo-lightbox.tsx          # Full-screen photo viewer
  guest-cart-merge.tsx        # Handles merging guest cart on login
  pricing-section.tsx         # Pricing plans UI
```

**Photo action icons.** `PhotoActionIcon` (`src/components/ui/photo-action-icon.tsx`) is the standard for
all photo action buttons: dark semi-transparent background (`bg-gray-900/60 backdrop-blur-sm`), white icon;
outline = inactive, filled = active — **no colour changes**; always visible on mobile, hover-visible on
desktop (parent handles it with `group` + `md:opacity-0 md:group-hover:opacity-100`); always wrapped in a
Shadcn `Tooltip`. Pages consume it via `photo-icon-buttons.tsx`, `photo-more-menu.tsx`,
`event-save-button.tsx` — never directly. (There is no `/events/[slug]` route; the public event route is
`/events/[shareCode]`.)

## Event Search

The search bar (`src/components/event-search-bar/`) queries Supabase directly — no external APIs:
`events.name/city/country ILIKE '%query%'`, photographers matched separately on
`profiles.username OR profiles.display_name` (`src/database/queries/events.ts:415` and `:487`). Results are
grouped by type; Activity/When filters live in a separate modal opened by a Filters button outside the
input. ⚠️ **Google Places is used ONLY in the location field of event create/edit forms — never in search.**

## Image Handling

- Original photos: Supabase Storage (private). Purchased photos: short-lived signed URLs — never expose the
  original storage path publicly. Watermark: tiled repeating pattern, server-side via Sharp.
- ⚠️ **The watermark route picks the treatment server-side from the photo's event** — never from the caller,
  and only from a `photos` row whose `event_id` matches the path's event segment: tiled watermark +
  degraded quality for `watermark_enabled` events, the clean baked-medium-thumbnail treatment for events
  selling without a visible mark (T-133). **Unknown policy fails closed to the watermark treatment.**
- **Who may set `watermark_enabled` is one shared rule (T-211): `src/lib/watermark-policy.ts`.** A **private
  non-organizer** event is already protected by its share code, so the visible watermark is forced **off**
  whatever the form sent; **organizer** events are exempt because they are *always* private (without the
  carve-out none could ever be watermarked). `resolveWatermarkEnabled` is called by both event actions and
  `isWatermarkConfigurable` by both forms + the wizard review, so the switch renders **disabled and off**
  exactly where the save would override it. The server stays the authority. ⚠️ **Do not "simplify" by
  dropping the private-event rule** — `needsProtectedPreview` reads `watermark_enabled`, so flipping it
  changes how existing events' previews are served.
- ⚠️ **For-sale photos (watermarked or not) must never resolve to a direct signed full-res original
  pre-purchase.** Enforced via the shared predicate `needsProtectedPreview`
  (`src/lib/preview-protection.ts`) in the cart pre-bake fallback (`getPhotoPreviewUrls`), every gallery
  signing site, and the **event-card cover + `og:image` fallbacks** (via the shared chokepoints
  `signEventCoverUrls` / `resolveEventOgImageUrl` in `src/database/queries/event-covers.ts`): anything
  watermarked OR for-sale (`price_per_photo` non-null — **0 counts**) routes through `/api/watermark/`; only
  an event positively known to be free (null price) AND un-watermarked keeps the direct signed original.
  **New signing sites must use the predicate — never re-derive "is it watermarked?" locally.** A
  **dedicated cover image** (`events.cover_path`, T-055) is always direct-signed.
- **Uploads:** all paths validate via `src/lib/photo-upload.ts` before writing to storage — magic-byte check
  via Sharp, 50 MB per-file cap, content-type and extension **derived from the detected format**;
  `file.type` and `file.name` are never trusted. `validatePhotoBuffer`/`validatePhotoUpload` accept a
  per-call `{ maxBytes, allowedFormats, tooLargeMessage }` override so other upload paths reuse the exact
  magic-byte detection with tighter limits.
- ⚠️ **No Server Action may carry bulk image bytes (T-238). Vercel caps a serverless function's request
  body at 4.5 MB and the cap is not configurable** — a larger body is refused by the platform with its own
  413 (`FUNCTION_PAYLOAD_TOO_LARGE`) *before* Next runs, so it reaches no `try/catch`, no toast and no
  dictionary. `next.config.ts`'s `serverActions.bodySizeLimit` is honoured **only in local dev** and now
  reads `'4.5mb'`; the numbers live in **`src/lib/upload-limits.ts`** (client-safe). Two shapes:
  - **Photos and event covers go direct to Storage** via a signed upload URL, so the app's own 50 MB cap is
    the only one in play (`src/lib/upload-event-cover.ts`: `createEventCoverUploadUrlAction` → browser PUT →
    `attachEventCoverAction`; pattern from `events/[id]/upload-urls/actions.ts`). ⚠️ **The magic-byte
    validation moved, it did not disappear:** `attachEventCoverAction` downloads the stored object back,
    runs `validatePhotoBuffer`, and **deletes the object** if it isn't an image. It also refuses any path
    outside the caller's own `${userId}/${eventId}/` prefix, since attach takes a client-supplied path.
  - **Avatar and face-search selfie still cross a Server Action**, so they cap at
    `MAX_SERVER_ACTION_UPLOAD_BYTES` (**4 MB**, below the platform limit to leave room for the multipart
    envelope) and **downscale in the browser first** (`src/lib/image-downscale.ts`, best-effort: an
    undecodable file — HEIC outside Safari — passes through untouched and hits the size guard).

History: DECISIONS.md §4.

## Profile pictures / avatars (T-182)

Changed from `dashboard/{photographer,talent}/settings/profile` via the shared client component
`src/components/avatar-upload.tsx` + the shared Server Action `src/app/[lang]/actions/avatar.ts`
(`updateAvatarAction` / `removeAvatarAction`). This is the **second storage bucket**: `avatars` —
**public** (migration `20260726000000`), unlike the private `photos` bucket, because avatars render as
plain `<img src>` on public pages.

- **Write path:** authenticate → rate-limit (`avatar-upload:<userId>`, 20/h) → `validateAvatarUpload`
  (`src/lib/avatar-upload.ts` — magic bytes, **4 MB** `MAX_AVATAR_BYTES` from `src/lib/avatar-constants.ts`,
  pinned to `MAX_SERVER_ACTION_UPLOAD_BYTES`; allow-list jpeg/png/webp/heif/avif, tighter than photos) →
  re-encode to a **square 256px WebP** (`resizeAvatar`, `fit:'cover'` — the raw upload is never stored) →
  upload to `avatars/<userId>/<uuid>.webp` via **`supabaseAdmin`** (path derived from the authed id). No
  per-object write RLS policy exists on `avatars`, so the admin-backed action is the only writer.
- ⚠️ **`profiles.avatar_url` is the DURABLE source of truth** — read by the public profile, event cards and
  both dashboard layouts' header/nav/bottom-nav chrome (`getProfileFields(..., ['display_name','avatar_url'])`,
  preferred over auth metadata). The auth `user_metadata.avatar_url` write is a
  **best-effort, non-fatal** sync (via `syncAuthAvatarMetadata`, which checks the returned `{error}` —
  `updateUserById` does NOT throw) only so the **public-site** header (`user-avatar.tsx` via `useAuthUser`)
  reflects the change immediately. **Metadata is not authoritative: GoTrue re-syncs it from the Google
  identity on every sign-in**, so a custom avatar written there reverts on next login.
- **Ordering discipline:** validate → throttle → read prior avatar/slug → upload → **authoritative
  `updateProfile` write** (on failure, delete the just-uploaded object) → best-effort metadata sync →
  delete-on-replace → revalidate. Validation before the throttle (a bad pick costs no quota); the profile
  read before the upload (a read error can't orphan a fresh object).
- **Delete-on-replace:** `avatarObjectPathToDelete(url, userId)` returns a path ONLY when the URL is our
  `avatars` bucket AND under `<userId>/` (Google OAuth URLs and foreign paths return null, fail-closed).
  ⚠️ **The `photos` orphan-cleanup cron does NOT cover `avatars`.**
- **Errors are returned, not thrown:** `AvatarActionResult` is a discriminated union so the reason survives
  the RSC boundary; the client maps codes → localized `dict.avatarUpload.*` copy.
- **Legacy `avatar_url`** rows point at the full Google OAuth URL and are not migrated; both coexist.

## Reveal gate — search-only events (T-177)

Per-event setting `events.reveal_gate_enabled`: the event stays **publicly discoverable** but its photos are
**not browsable** — revealed only to a visitor who proves a **face-search** match (v1 is face-only; no bib
unlocking). `is_public`/`share_code` gate **access to the event**; the gate gates **visibility of the
photos** within it. They compose (AND): `isEventAccessible` decides the event, the gate decides its photos.

- **Enable preconditions** (enforced in both event actions, fail-closed): requires `ai_matching_enabled`
  (face search is the only key); forced off otherwise. ⚠️ **Minors are out of scope** — the invariant
  `contains_minors ⇒ !is_public` is enforced in both directions, so minors events get their privacy from
  the share code, not this gate.
- **Enforcement is at the LISTING paths only** — the fail-closed gate withholds photo IDs/URLs from an
  unproven visitor: the public event page's initial fetch + count (gated → skip the cached photo fetch, fetch
  the proven set per-request **outside** `'use cache'`), `loadMoreEventPhotos` (gated → `[]`), the
  talent-dashboard event view, and `resolveEventOgImageUrl` + `signEventCoverUrls` (suppress the first-photo
  fallback; a dedicated cover is still shown). Reads gate on `isEventRevealGated(event)`
  (`src/lib/reveal-token.ts`); the proven set is fetched via `getEventPhotosPublicByIds`, which intersects
  the proof ids with the approved public set — a stale/foreign id can't surface a photo.
- **Proof = signed cookie** `pm_reveal_<eventId>` (HMAC, `src/lib/reveal-token.ts`; request-scoped
  read/write in `src/lib/reveal-gate.ts`). `searchFacesInEvent` mints it over the matched ids so a reload
  re-serves them with no second billable face search. Fail-closed on tamper/expiry/wrong-event. Env
  `REVEAL_TOKEN_SECRET` (optional; falls back to the service-role key).
- ⚠️ **Security property (v1 — deliberate):** the image byte routes (`/api/watermark`, `/api/thumb`) are
  **NOT gated** — they serve by an unguessable storage path, so **the UUID is the secret**. The property is
  "photo IDs never reach an unproven visitor + exposure is limited", NOT byte-level access control. **Any
  future feature that surfaces a gated event's photo URL or ID to an unproven visitor breaks this** — new
  listing endpoints/embeds/exports must route through the gate. An event that was public and later gated
  already leaked its UUIDs, so the gate is partial for it. Cart/checkout/download are untouched (they need
  an ID the unproven visitor lacks).
- **UX:** the total photo count moves next to the header when gated; the toolbar counter shows only what's
  revealed; the gallery shows an intentional "search to find your photos" state.
- **Dead-end guard (T-184):** if the face-search entry can't render (nothing indexed, indexing in flight, or
  indexing failed) a gated visitor is stranded with no photos and no way to find them. Both viewing surfaces
  resolve `resolveGatedFaceSearchNotice({ gated, aiSearchEligible, aiUsable, aiStatus })`
  (`src/lib/find-my-photos.ts`) and render `<GatedFaceSearchNotice>` — `'processing'` (AI usable + status
  `idle`/`indexing`) or `'unavailable'` (failed / done-but-nothing-searchable / AI not usable). Non-gated
  events are unaffected. **The guard never exposes a photo without a match.**

History: DECISIONS.md §8.

## Security Utilities

The `src/lib/` modules below enforce conventions across the app. Use them — don't reinvent.

**`src/lib/photo-upload.ts`** — `validatePhotoUpload(file)`. Magic bytes via Sharp, rejects unknown formats,
50 MB cap. Returns `{ buffer, contentType, extension }` derived from the detected format. Apply on every
upload path before writing to storage.

**`src/lib/json-ld.ts`** — `stringifyJsonLd(value)`. Use instead of `JSON.stringify` whenever embedding
structured data in an inline `<script>` via `dangerouslySetInnerHTML`. Escapes `<`, `>`, `&`, U+2028,
U+2029 so a user-supplied field containing `</script>` cannot break out.

**`src/lib/rate-limit.ts`** — `rateLimit({ key, limit, windowSec })`. Postgres-backed fixed-window limiter.
Apply to: endpoints that hit external APIs (Stripe, Resend) on every call; endpoints with sequential or
guessable id parameters; unauthenticated endpoints with side effects. Helpers: `getClientIp(headers)`,
`retryAfterSeconds(result)`. **Fails open** on backend errors. Backend is pluggable via `RateLimitBackend`.

**`src/lib/auth/require-user.ts`** — `requireUser()`. Returns the request's authenticated user or redirects
to login (`redirectToLogin()`), reading through the request-cached `getUser()`.
⚠️ **Call it first in every dashboard layout/page that reads auth-dependent data** — Next renders a route's
segments *in parallel*, so the login guard in `dashboard/layout.tsx` does **not** stop a child layout or
page from executing. A child that reacts to a missing session by *throwing* (`getRoleContext`,
`getProfileFields(supabase, '')`, `getDashboardData`, …) races the parent's `NEXT_REDIRECT` into
`[lang]/error.tsx` (T-198's intermittent "Something went wrong"). Redirecting instead of throwing makes the
race harmless. Pinned by `test/unit/src/app/dashboard-auth-guard.test.ts` and
`dashboard-guard-coverage.test.ts` (**add new segments to that list**).

**`src/lib/auth/safe-next.ts`** — `safeNext(value)`. Use for any redirect destination derived from user
input (`?next=`, OAuth callback). Rejects protocol-relative URLs (`//evil.com`), backslash variants, and
control characters.

## Testing

Vitest + Supabase local (Docker) for integration. Conventions and debugging tips: [`test/README.md`](./test/README.md).

| Command | What it does |
|---|---|
| `pnpm test` | Every test once (integration assumes the local stack is already up) |
| `pnpm test:unit` | Unit tests only (`test/unit`) — no Docker, fast inner loop |
| `pnpm test:integration` | Boots Supabase, runs `test/integration`, stops it |
| `pnpm test:watch` / `test:coverage` | Watch mode / coverage report under `coverage/` |
| `pnpm db:start` / `db:stop` / `db:reset` | Boot or reset the local Supabase stack |

```
test/
  unit/                # No Docker. Mostly pure functions; mocks where needed
    lib/               # Helpers under src/lib/ (largest group)
    src/{lib,app}/     # Newer tests mirroring the src/ path
    actions/ api/ components/  # Mocked Server Actions, route handlers, RTL components
  integration/         # Hit local Supabase via test helpers
    actions/ api/ queries/ security/ inngest/
  helpers/             # supabase-test-client.ts, server-action-mocks.ts,
                       # database-server-mock.ts, image.ts
  setup.ts             # env-var defaults loaded before each test file
```

- **Every bug fix ships with a regression test** that fails before the fix and passes after.
- **Every new feature includes tests for the critical paths** — Server Actions, queries, payment flows,
  security helpers. UI polish can ship without component tests; payment/auth/data flow cannot.
- **Choose the client deliberately** in integration tests: service-role to assert *query behavior*,
  anon/user-scoped to assert *RLS behavior*.
- **Use `beforeEach(resetDatabase)`** so ordering can't quietly pass or fail one.
- **Keep helpers pure where possible.**
- Coverage target is **60%** on lines/branches/functions/statements; thresholds are not enforced in
  `vitest.config.ts` yet (uncomment `thresholds:` when ready).
- **Troubleshooting:** integration tests failing en masse with `permission denied for table …` (`42501`)
  means the local API roles are missing their DML grants — a known Supabase CLI provisioning fallout. The
  grants live in `supabase/seed.sql` (local-only); run `pnpm db:reset` once. The pre-flight in
  `test/helpers/supabase-test-client.ts` surfaces this as a single clear error.

## AI Photo Search

**Enabled** (`AI_MATCHING: true`). AWS Rekognition face collections + Inngest — not the old pgvector/CLIP
path (removed in `20260518000000_drop_legacy_ai_schema.sql`).

- **Indexing (photographer side):** a new photo emits a `photo.uploaded` Inngest event. `indexPhotoFaces`
  (`src/lib/inngest/functions/index-photo-faces.ts`) downloads the image, calls Rekognition `IndexFaces`,
  writes `photo_faces`; `generatePhotoThumbnails` runs in parallel off the same event. Enabling AI on an
  existing event fans out via `backfillEventIndexing`; disabling or deleting tears down the AWS collection
  (`disableEventIndexing` / `cleanupOnEventDelete`).
- **Search (talent side):** `searchFacesInEvent` (`events/[shareCode]/actions.ts`, surfaced by
  `event-gallery-with-face-search.tsx`) validates a selfie, calls `SearchFacesByImage` (threshold 80), maps
  matched face IDs to photos via `getPhotoFacesByAwsFaceIds`, filters to public/approved/non-minor photos,
  and buckets results (`very-likely` 95+, `likely` 85+, `possibly` 80+). **Selfies are ephemeral — never
  persisted.** Capped at **4 MB** and downscaled in the browser (T-238; Rekognition accepts at most 5 MB).
- **AWS calls** (`src/lib/aws/`): `CreateCollection`/`IndexFaces`/`SearchFacesByImage`/`DeleteFaces`/
  `DeleteCollection`. Collections named `${REKOGNITION_COLLECTION_PREFIX}-${env}-event-${eventId}`
  (`src/lib/aws/collection-naming.ts`).
- **Error safety:** every AWS/Sharp/Storage call in these flows is wrapped in `safeCall`
  (`src/lib/safe-call.ts`) so image buffers can't leak into Inngest step output or serverless error
  responses.
- **Backfill de-duplication (T-089):** both per-event backfill workers are cost gates (one AWS-billed job
  per photo). Both declare `debounce: { key: 'event.data.eventId', period: BACKFILL_DEBOUNCE_PERIOD }`
  (`backfill-config.ts`) plus `concurrency: [{ limit: 1, key: 'event.data.eventId' }]` as a backstop.
  ⚠️ **Debounce, not an event-`id` idempotency key** — that key's 24h dedup memory would silently drop a
  legitimate later re-index or a disable→re-enable. The trigger sends and the per-photo fan-out sends carry
  **no** dedup key: a re-index must legitimately re-process each photo.
- **Rate limits / cost controls (T-034):** anonymous face search is gated by **three tiered atomic Postgres
  counters** (all keyed on the resolved `event.id`, via `rate_limit_buckets` + `SECURITY DEFINER` RPCs,
  **decided on the RETURNED count** so a concurrent burst can't undercount): **(1)** per-`(event, IP)`/hour
  request throttle (10/h); **(2)** per-**event**/day cost cap; **(3)** global/day **circuit breaker**. Tiers
  2 & 3 count real billable AWS calls — `AWS_CALLS_PER_FACE_SEARCH` (`src/lib/face-search-limits.ts`) is
  **1** (detection and search are bundled — there is **no** separate `DetectFaces` call). ⚠️ **Order
  matters: tier 1 and selfie validation run BEFORE the cost counters**, or an IP-throttled attacker could
  inflate the global breaker; a per-event trip never touches the global counter. Caps are
  **env-configurable, never hardcoded** (`FACE_SEARCH_GLOBAL_DAILY_CALLS` 2000,
  `FACE_SEARCH_EVENT_DAILY_CALLS` 1000). A 50%-of-global email alert (`FACE_SEARCH_ALERT_EMAIL`; absent ⇒
  no-op) fires once per day-window via an atomic claim bucket. A breaker trip throws
  `RATE_LIMIT:face-search:unavailable` → `aiSearch.modal.errorUnavailable`, and leaves bib search and the
  rest of the app unaffected. CAPTCHA is deliberately **not** built here (tripwire T-141).
  ⚠️ **There is no per-plan monthly search quota** (removed in T-036 — the anonymous searcher isn't the plan
  owner); don't re-advertise a "N searches/month" number.
- **Indexing-state reconciliation (T-099, T-183):** `reconcileIndexingState`
  (`src/lib/inngest/functions/reconcile-indexing.ts`, `15,45 * * * *`) self-heals four wedges with no other
  recovery path — (a) events stuck `ai_matching_status='indexing'`, (b) events whose in-flight count is
  already 0, (c) thumbnails that never baked, (d) **owner uploads stranded `upload_status='pending'`** in
  events not wedged in `indexing` (branch (a) owns those). Constraints:
  - ⚠️ **(d) re-emits `photo.uploaded` and re-drives the real worker — never flips the row to `approved`
    here**, or the byte-validation gate is skipped.
  - ⚠️ **`failed` photos are left alone** (retries exhausted; recovery is a manual action, no retry storm) —
    hence `listStuckPendingOwnerUploads` also excludes `face_index_status='failed'` (T-231).
  - The owner-upload predicate is `photos.user_id = events.user_id` AND `guest_name IS NULL` AND
    `uploaded_by IS NULL`, applied in JS after an inner-join fetch (PostgREST can't express it).
  - A **1-hour staleness gate** on `events.updated_at` / `photos.created_at` keeps it from clobbering live
    re-indexes; the T-092 ready-guard stops a re-emit from re-baking an already-`ready` thumbnail.
- **Worker route:** all Inngest functions are registered at `/src/app/api/inngest/route.ts`.
- ⚠️ **Cron slots are deliberately offset** so the four never contend: `0,30` storage cleanup · `15,45`
  indexing reconciliation · `10,40` payout retries · `25,55` order-payout reconciliation (T-255).
  **Pick a fifth slot for any new cron.**
  ⚠️ `retry-pending-payouts` is **one** function with a cron trigger *and* a `payouts.retry-requested` event
  trigger — Inngest scopes `concurrency` per function id, so splitting it into two registrations would give
  two independent limits and allow concurrent payout runs for the same photographer.

## BIB number recognition (T-032)

Race **bib-number** detection, **per-event opt-in** (the cost gate, mirroring `ai_matching_enabled`). Shares
the Rekognition client + Inngest + `safeCall` conventions with face matching.

- **Opt-in:** `events.bib_detection_enabled` (default false) + `bib_detection_status`. Toggled on the event
  detail page (`enable/disableBibDetectionForEvent`, owner-only); enabling fires
  `event.bib-detection-enabled` → `backfillEventBibDetection`. Disabled for `contains_minors` events (parity
  with face search). **Disabling keeps existing bib rows.**
- **Detection:** `detectPhotoBibs` (`src/lib/inngest/functions/detect-photo-bibs.ts`) on `photo.uploaded` +
  `photo.bib-detect`; no-ops (status stays NULL) unless the event opted in. Calls `DetectText`
  (`src/lib/aws/bib-detection.ts`), filters via `extractBibCandidates` (`src/lib/bib-numbers.ts` —
  confidence floor + digit-dominant pattern + dedupe + cap), persists to `photo_bib_numbers`. Bytes never
  cross Inngest step boundaries. **Backfill fans out a bib-specific `photo.bib-detect` event so it never
  re-runs the face/thumbnail jobs.**
- **Persistence:** `photo_bib_numbers` (`photo_id`, `bib_text`, `confidence`, `bounding_box`, unique
  `(photo_id, bib_text)`) — RLS read like `photo_faces`, service-role writes only. ⚠️ **This table is both
  the raw detection data and the search target**; `photos.bib_detection_status` is the per-photo **job
  status only** (nullable; `pending`/`detecting`/`detected`/`no_bibs`/`failed`/`not_applicable`) and never
  holds bib values. Queries in `src/database/queries/bib-numbers.ts`.
- **Search:** `searchPhotosByBibInEvent(shareCode, bib)` — exact normalized match, rate-limited
  `(shareCode, IP)` 30/h, returns matching **public** photo ids. Surfaced via the unified
  `FindMyPhotosBanner` (`src/components/find-my-photos-banner.tsx`) on **both** the public event gallery and
  the talent-dashboard event view, gated on `bib_detection_enabled`; results filter the grid client-side on
  both surfaces (symmetric wiring). Enabling/disabling busts the event cache tags
  (`revalidateEventPhotoCacheTags`) so the bar appears/disappears immediately (T-064).
- **Privacy / cost:** bib numbers are low-sensitivity race identifiers (not PII); the `contains_minors`
  parity keeps minors' photos no more exposed than face search already allows. `DetectText` is billed per
  image on opted-in events — the per-event opt-in is the only throttle. No new env vars.

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

# Money incidents (T-249, T-215)
MONEY_ALERT_EMAIL=                   # ops recipient for reportMoneyIncident; absent ⇒ log + Sentry only

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
# Sender is hardcoded ('Photo Markt <noreply@photomarkt.com>') as EMAIL_FROM in src/lib/email/send-email.ts

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
⚠️ ~140 merged remote branches exist; **`main` is the only source of truth for what shipped** — never read a
branch name as a feature's status.

## Working with Claude

### When to use Planning Mode
Two mechanisms, in this order — one is **not** a substitute for the other:
1. **Plan mode** (`EnterPlanMode` → `ExitPlanMode`) is the only real gate: writes are blocked and the user
   must approve. Use it when the work touches **payments, auth/security, or DB/migrations**, or when the
   architecture is genuinely unclear.
2. **OpenSpec** (`/opsx:propose` → `/opsx:apply`) then **records the already-approved plan** as artifacts
   that travel in the PR. It writes files, so it **cannot run inside plan mode** — approve first, record
   second. It is documentation, not a gate.

Skip both for: bug fixes, UI tweaks, adding fields, isolated features, translations, refactoring individual
files. Same threshold as `/work-next` step 3, which reads it off the ticket's `Riesgo:` field — keep the two
in sync.

### Token Budget Guidelines
- Bug fixes: 3–8k · UI changes / isolated features: 5–15k · Medium features (3–5 files): 15–25k ·
  Large features (payments, auth, multi-page): 25–40k

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
- New features include tests for critical logic; bug fixes include a regression test that fails before the
  fix and passes after

### Security Conventions
- File uploads must validate via `src/lib/photo-upload.ts` — never trust client-supplied MIME or extension
- JSON-LD inside `dangerouslySetInnerHTML` must use `stringifyJsonLd` — never raw `JSON.stringify`
- Admin-gated surfaces check `admin_users` via `supabaseAdmin` — **there is no `profiles.is_admin` column**
  (dropped by `20260513000000`, re-dropped defensively in T-219), and
  `test/unit/database/dead-schema-pruned.test.ts` **fails on any `is_admin` reference under `src/`**.
  ⚠️ **That guard is the point: a column named like a gate that gates nothing is how the next bypass gets
  written in good faith** — `profiles` has a public SELECT policy, which is why the flag was moved out of
  it. The only admin surface is `[lang]/dashboard/admin/status/page.tsx`, which `notFound()`s a non-admin
- New `SECURITY DEFINER` functions in the `public` schema must explicitly
  `revoke execute ... from anon, authenticated` — Supabase grants those by default and `revoke from public`
  doesn't override role-specific grants. ⚠️ **`drop function` throws the grants away and Postgres re-grants
  `EXECUTE` to `PUBLIC` on the replacement**, so a migration that drops and recreates one must re-apply the
  revoke in the same file (`20260804000000`); the inventory test in
  `test/integration/security/security-definer-rpcs.test.ts` fails if it doesn't
- A `SECURITY DEFINER` **search** RPC is reachable directly through PostgREST with a user JWT, so the Server
  Action wrapping it guards nothing: the function itself must escape `%`/`_`/`\` before building its `LIKE`
  pattern (and pass `escape '\'` on every `like`, `order by` included), require a minimum search length, and
  **cap the row limit server-side** — the caller controls that argument. `search_users_by_text`
  (`20260804000000`) is the reference shape
- ⚠️ **Matching a substring of a secret and returning a stable id is an oracle**, even if the secret is not
  in the returned columns — the caller learns, one probe at a time, whether a given user's value contains a
  given string. So `search_users_by_text` neither returns **nor substring-matches** email: it matches email
  by **exact equality**, keeps substring matching for `username`/`display_name`, and keeps email out of the
  `order by`. Prefer resolving PII server-side from known ids (`get_user_emails_batch`)
- ⚠️ **Every table in `public` must be declared in `test/integration/security/rls-table-inventory.test.ts`
  (T-227)** as `policies-tested` or `total-denial`, with a reason. A new table fails the suite until
  someone decides which it is. Sibling gate to the `SECURITY DEFINER` inventory, and for the same
  reason: **RLS is the ONLY barrier** — all 26 tables grant SELECT/INSERT/UPDATE/DELETE to `anon` and
  `authenticated` (Supabase's default, re-applied locally by `supabase/seed.sql`). The same test pins
  three properties an allow-list cannot fake: RLS enabled everywhere, no `USING (true)`, and **no
  TRUNCATE for the API roles** (TRUNCATE is not subject to RLS).
- ⚠️ **`profiles` is read by `anon` through an explicit COLUMN allow-list, not the whole row (T-227).**
  `photographer_profiles_public_select` is `USING (active_role = 'PHOTOGRAPHER')` and RLS is row-level,
  so before the fix an unauthenticated `GET /rest/v1/profiles` returned the photographer's legal name,
  postal address, Stripe ids and payout jsonb — and `active_role` DEFAULTS to `PHOTOGRAPHER`. The grant
  in `20260906000000` is now the allow-list: **a new public column must be added there, a sensitive one
  never is**, and the same list must be repeated in `supabase/seed.sql` (its blanket grant runs after
  the migrations and would otherwise restore the exposure locally) — the inventory test compares the
  granted set against one declared constant, so the three copies cannot drift silently.
  ⚠️ **Two halves are deliberately still open, both pinned as KNOWN GAP tests and tracked in T-268:**
  `authenticated` keeps table-wide SELECT (a column grant cannot tell "my row" from "another's"), and
  the allow-list is **SELECT only** — `profiles_self_update` restricts the row but not the columns, so
  a photographer can still PATCH their own `stripe_connect_*` / `payout_*`. Bounded because every money
  path re-derives Connect status from Stripe before transferring.
- ⚠️ **A policy's nested table reads are RLS-filtered too.** `photo_faces` / `photo_bib_numbers` read as
  if `e.is_public = true` granted public access; it never fires, because the `EXISTS` over
  `photos`/`events` is itself subject to those tables' owner-only policies. That is why `orders` uses
  the `order_has_photographer_items` SECURITY DEFINER helper for its photographer branch — a plain
  nested `EXISTS` could not express it.
- Tables with no public access pattern: enable RLS with no policies, use `supabaseAdmin` only — see
  `admin_users` and `rate_limit_buckets`
- Redirect destinations from user input must go through `safeNext()`
- Permissive RLS policies (`USING (true)`) are forbidden on tables with sensitive writes — service-role
  bypasses RLS, so the webhook/admin paths still work after locking down user-facing roles
- **Supabase's security advisors are a CI gate (T-225).** `.github/workflows/supabase-advisors.yml` runs on
  every PR touching `supabase/migrations/**` and fails on any `ERROR`/`WARN` finding not declared in
  `scripts/advisors-baseline.ts` (each accepted entry carries its one-line reason). It runs against
  **staging**, pinned by the `projectRef` in that file. It does **not** replace the `SECURITY DEFINER`
  inventory test — that reads the schema rebuilt from `supabase/migrations/`, this reads a real project and
  catches drift the migrations don't describe. Run it locally with `pnpm advisors:check`

History: DECISIONS.md §9 and §10.
