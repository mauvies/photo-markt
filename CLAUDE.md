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
    page.tsx            # Home page (static)
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
    stripe/             # Stripe webhook and checkout handlers
    watermark/          # Watermarked image serving
```

### Role-Based System

Two user roles with separate dashboards:
- **PHOTOGRAPHER** (`/dashboard/photographer`) — manages events, uploads/manages photos, tracks sales and earnings, manages payout account
- **TALENT** (`/dashboard/talent`) — browses events, finds and purchases photos of themselves, manages saved photos

Role is stored in `profiles.active_role`. Users can switch roles. Initial role assigned during onboarding via `src/app/[lang]/actions/roles.ts`.

### Key Architectural Patterns

**Server Actions for mutations**
All data mutations use `"use server"` actions in `actions.ts` files colocated next to their page components. Do not create new API routes for mutations — use server actions instead.

**Database query layer**
All Supabase queries live in `/src/database/queries/`. Each domain has its own file. Always add new queries here — never inline in components or actions.

```
src/database/queries/
  events.ts           # Event CRUD and search
  photos.ts           # Photo management and embedding
  profiles.ts         # User profiles
  orders.ts           # Purchase orders
  carts.ts            # Cart management
  sales.ts            # Photographer sales data
  earnings.ts         # Photographer earnings
  photographers.ts    # Photographer-specific queries
  talent-library.ts   # Talent saved photos
  subscriptions.ts    # Stripe subscription data
  payment-accounts.ts # Photographer payout accounts
  payouts.ts          # Payout requests
  storage.ts          # Supabase Storage helpers
  ai-search-profiles.ts
  ai-search-usage.ts
  ai-similarity-search.ts
  index.ts            # Central export
```

**Supabase clients**
- Server-side (Server Components, Server Actions, API routes): `src/database/server.ts`
- Client-side (Client Components): `src/database/client.ts`
- Admin (service role, bypasses RLS): `src/database/supabase-admin.ts`

**Middleware**
`src/proxy.ts` (Next.js middleware) refreshes Supabase auth sessions on every request and handles locale detection.

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
`id, user_id, name, date, session_time, session_end_time, start_date, end_date, city, country, state, activity, is_public, share_code, price_per_photo, watermark_enabled, slug, lat, lng, time_offset, time_sync_enabled, deleted_at, created_at, updated_at`
- Soft delete via `deleted_at`
- `state` field tracks event status (`upcoming` / `completed`) based on date
- `time_sync_enabled` + `time_offset` support the camera time sync feature (when each *photo* was taken)
- `session_time` (nullable `time`) is a **separate** concept — the manual session start time the photographer types, for display only; naive local time-of-day, not tied to `time_offset`/`time_sync_enabled` (T-106). `session_end_time` (nullable `time`, T-180) is its mirror — the manual session end; when both are set the UI shows a range ("09:30 – 12:00") via `formatSessionTimeRange`. App-level rule: an end requires a start and must be after it (`isValidSessionRange`); the column carries no constraint
- `share_code` allows access to private events

**photos** (via `/src/database/queries/photos.ts`)
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

**ai_search_profiles**
`id, user_id, activity_type, country, region, date_from, date_to`
- Stores a talent's saved face-search filters. The old `selfie_embedding` column was dropped (migration `20260518000000_drop_legacy_ai_schema.sql`) — selfies are sent to AWS Rekognition per search and never stored. The Rekognition events table fields (`ai_matching_enabled`, `contains_minors`, `rekognition_collection_id`, `rekognition_region`, `ai_matching_status`) gate indexing per event

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
  true by construction. `<BuyerFeeNote>` (`src/components/buyer-fee-note.tsx`) states this on both
  tabs and renders **nothing** while `isBuyerServiceFeeEnabled()` is false, so a fee nobody pays is
  never explained.
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
- **Used in:** `/events/[slug]`, `/dashboard/photographer/events/[id]`, `/dashboard/talent/events/[id]`, `/dashboard/talent/photos`, `/dashboard/talent/profile`

## Event Search

Search bar (`src/components/event-search-bar/`) queries Supabase directly — no external APIs:
```sql
events.name ILIKE '%query%'
OR events.city ILIKE '%query%'
OR profiles.display_name ILIKE '%query%'
```
- Results grouped by type: events and photographers
- Filters (Activity, When) in a separate modal opened by a Filters button outside the input
- Google Places API used **only** in location field of event create/edit forms — never in search

## Image Handling

- Original photos: Supabase Storage (private)
- Previews: protected via `/src/app/api/watermark/` — the route picks the treatment server-side from the photo's event (never from the caller, and only from a photos row whose `event_id` matches the path's event segment): tiled watermark + degraded quality for `watermark_enabled` events, the clean baked-medium-thumbnail treatment for events selling without a visible mark (T-133). Unknown policy fails closed to the watermark treatment
- Purchased photos: short-lived signed URLs — never expose original storage path publicly
- Watermark: tiled repeating pattern, server-side via Sharp
- For-sale photos (watermarked or not) must never resolve to a direct signed full-res original pre-purchase. Enforced via the shared predicate `needsProtectedPreview` (`src/lib/preview-protection.ts`, T-131/T-133/T-136) in the cart pre-bake fallback (`getPhotoPreviewUrls`), every gallery signing site (public event page + load-more, talent event view, talent dashboard, favorites), and the **event-card cover + `og:image` fallbacks** (T-140, via the shared chokepoints `signEventCoverUrls` / `resolveEventOgImageUrl` in `src/database/queries/event-covers.ts` — used by talent explore, saved events, photographer profile, and the public event page's `generateMetadata`): anything watermarked OR for-sale (`price_per_photo` non-null — 0 counts, matching `isForSale` and the download gates) routes through `/api/watermark/`; only an event positively known to be free (null price) AND un-watermarked keeps the direct signed original. A **dedicated cover image** (T-055, `events.cover_path`) is always direct-signed — it's a promotional presentation image, not a for-sale photo (and isn't a `photos` row, so the watermark route can't resolve a policy for it). New signing sites must use the predicate — never re-derive "is it watermarked?" locally
- **Uploads:** all paths (photographer + guest collaborative) validate via `src/lib/photo-upload.ts` before writing to storage. Magic-byte check via Sharp, 50 MB per-file cap, content-type and extension are derived from the detected format — `file.type` and `file.name` are never trusted. `validatePhotoBuffer`/`validatePhotoUpload` accept a per-call `{ maxBytes, allowedFormats, tooLargeMessage }` override (defaults preserve photo behavior) so other upload paths reuse the exact magic-byte detection with tighter limits

## Profile pictures / avatars (T-182)

Users change their avatar from `dashboard/{photographer,talent}/settings/profile` via the shared client component `src/components/avatar-upload.tsx` + the shared Server Action `src/app/[lang]/actions/avatar.ts` (`updateAvatarAction` / `removeAvatarAction`). This is the **second storage bucket**: `avatars` — **public** (migration `20260726000000_create_avatars_bucket.sql`), unlike the private `photos` bucket, because avatars render as plain `<img src>` on public pages.

- **Write path:** the action authenticates the user, rate-limits (`avatar-upload:<userId>`, 20/h), validates via `validateAvatarUpload` (`src/lib/avatar-upload.ts` — magic bytes, **8 MB** cap `MAX_AVATAR_BYTES`, allow-list jpeg/png/webp/heif/avif; tighter than photos), re-encodes to a **square 256px WebP** (`resizeAvatar`, `fit:'cover'` — raw upload is never stored), and uploads to `avatars/<userId>/<uuid>.webp` via **`supabaseAdmin`** (RLS-bypass; path derived from the authed id). No per-object write RLS policy exists on `avatars` — anon/authenticated are default-denied, so the admin-backed action is the only writer.
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
  unit/                # Pure functions — no DB, no mocks
    src/lib/               # Tests for helpers under src/lib/
  integration/         # Hit local Supabase via test helpers
    actions/           # Server Actions
    api/               # API route handlers (Stripe webhook, etc.)
    queries/           # src/database/queries/* layer
    security/          # RLS regression tests
  helpers/
    supabase-test-client.ts   # createTestUser / createTestEvent / resetDatabase / ensurePhotosBucket
    server-action-mocks.ts    # shared mockSession for Server Action tests
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
- **Indexing-state reconciliation (T-099, T-183):** `reconcileIndexingState` (`src/lib/inngest/functions/reconcile-indexing.ts`) is an hourly cron (`15,45 * * * *`, offset from the storage-cleanup cron) that self-heals three silent wedges with no other recovery path: an event stuck in `ai_matching_status='indexing'` forever (a lost `photo.uploaded` or a missed `maybe-mark-event-ready` step), a thumbnail that never bakes (a swallowed best-effort `emit-processed`), and (T-183) an **owner upload stranded in `upload_status='pending'`** (a lost `photo.uploaded` or a run that died before the worker's `promote-upload-status` step — invisible on the approved-only galleries AND absent from the owner's Pending tab, so the dashboard count says N while only the approved subset renders). It (a) re-emits `photo.uploaded` for still-in-flight photos of wedged events, (b) flips events whose in-flight count is already 0 to `ready`, (c) re-emits `photo.processed` for terminally-indexed photos whose `thumbnail_status` is still `pending`, and (d) re-emits `photo.uploaded` for **owner uploads** stuck `upload_status='pending'` in events **not** wedged in `indexing` (branch (a) owns that case) — re-driving download → byte-validation → promotion via the real worker rather than flipping the row to `approved` here, so the byte-validation gate is never skipped. The owner-upload predicate is `photos.user_id = events.user_id` AND `guest_name IS NULL` AND `uploaded_by IS NULL` (`listStuckPendingOwnerUploads` in `photos.ts`; the column-to-column comparison is applied in JS after an inner-join fetch, since PostgREST can't express it). A **1-hour staleness gate** keyed on the trigger-maintained `events.updated_at` (for events) / `photos.created_at` (for thumbnails and owner uploads) keeps it from clobbering live re-indexes; `failed` photos are left alone (they exhausted retries — re-index is a manual action, no retry storm). Idempotent + the T-092 ready-guard stops any re-emit from re-baking an already-`ready` thumbnail.
- **Worker route:** all Inngest functions are registered at `/src/app/api/inngest/route.ts`.

## BIB number recognition (T-032)

Race **bib-number** detection, **per-event opt-in** (the cost gate, mirroring `ai_matching_enabled`). Shares the Rekognition client + Inngest + `safeCall` conventions with face matching.

- **Opt-in:** `events.bib_detection_enabled` (default false) + `bib_detection_status`. Photographer toggles it on the event detail page (`enable/disableBibDetectionForEvent`, owner-only); enabling fires `event.bib-detection-enabled` → `backfillEventBibDetection`. Disabled for `contains_minors` events (parity with face search). Disabling **keeps** existing bib rows.
- **Detection (job):** `detectPhotoBibs` (`src/lib/inngest/functions/detect-photo-bibs.ts`) on `photo.uploaded` + `photo.bib-detect`; no-ops (status stays NULL) unless the event opted in. Downloads the image, calls Rekognition `DetectText` (`src/lib/aws/bib-detection.ts`), filters to plausible bibs (`extractBibCandidates` in `src/lib/bib-numbers.ts` — confidence floor + digit-dominant pattern + dedupe + cap), persists to `photo_bib_numbers`. Bytes never cross Inngest step boundaries; AWS/Storage/Sharp wrapped in `safeCall`. Backfill fans out a **bib-specific** `photo.bib-detect` event so it never re-runs the face/thumbnail jobs.
- **Persistence:** `photo_bib_numbers` (`photo_id`, `bib_text`, `confidence`, `bounding_box`, unique `(photo_id, bib_text)`) — RLS read like `photo_faces`, service-role writes only. Per-photo `photos.bib_detection_status`. Queries in `src/database/queries/bib-numbers.ts`.
- **Search (talent):** `searchPhotosByBibInEvent(shareCode, bib)` (`events/[shareCode]/actions.ts`) — exact normalized match, rate-limited `(shareCode, IP)` 30/h, returns matching **public** photo ids. Surfaced via the unified `FindMyPhotosBanner` (`src/components/find-my-photos-banner.tsx` — the face + bib "Find my photos" card; bib input opens in a modal) on both the public event gallery (`/events/[shareCode]`) and the talent-dashboard event view (`/dashboard/talent/events/[id]`), gated on `bib_detection_enabled`; results filter the grid client-side on **both** surfaces (symmetric wiring — the old talent-dashboard grid-filter gap is fixed). Enabling/disabling bib detection busts the public/talent event cache tags (`revalidateEventPhotoCacheTags`) so the bar appears/disappears immediately (T-064).
- **Privacy:** bib numbers are low-sensitivity race identifiers (not PII); selfies/faces unaffected. `contains_minors` parity keeps minors' photos no more exposed than face search already allows.
- **Cost:** `DetectText` is billed per image on opted-in events — the per-event opt-in is the only throttle (no per-event cap yet). No new env vars (reuses `AWS_*`/`REKOGNITION_*`).

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_AMATEUR=        # Starter plan monthly price ID
STRIPE_PRICE_PRO=            # Pro plan monthly price ID
STRIPE_PRICE_AMATEUR_YEARLY= # Starter yearly price ID (optional; required only once yearly checkout is enabled)
STRIPE_PRICE_PRO_YEARLY=     # Pro yearly price ID (optional; same as above)
PLATFORM_FEE_BPS=            # Platform fee in basis points

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

# Inngest (background-processing worker for face indexing)
INNGEST_EVENT_KEY=                   # signs outbound inngest.send() calls
INNGEST_SIGNING_KEY=                 # verifies inbound webhook payloads at /api/inngest

# Email
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# Sentry error monitoring (all optional — SDK is a no-op without a DSN)
SENTRY_DSN=                          # server/edge DSN; absent ⇒ no server error capture
NEXT_PUBLIC_SENTRY_DSN=              # browser DSN; absent ⇒ no client error capture
SENTRY_ORG=                          # build-time only (source-map upload)
SENTRY_PROJECT=                      # build-time only (source-map upload)
SENTRY_AUTH_TOKEN=                   # build-time only; source maps upload only when set

# App
SITE_URL=
```

## Active Feature Branches

Check these branches before touching related code:

| Branch | Description |
|--------|-------------|
| `feature/stripe-connect` | Photographer payouts via Stripe Connect |
| `feature/event-status` | upcoming/completed event states |
| `feature/guest-cart-merge` | Guest cart persistence and merge on login |
| `feature/home-top-events` | Featured events section on home page |
| `feature/photographer-profiles` | Public photographer profile pages |
| `feature/location-autocomplete` | Google Places in event forms |
| `feature/search-bar-refactor` | Airbnb-style search bar with filter modal |
| `feature/i18n-localization` | i18n routing and locale detection |
| `feature/i18n-client-translations` | Client-side translations provider |
| `feature/seo-overhaul` | Metadata, JSON-LD, sitemap |
| `feature/refactor-backend` | Backend code cleanup |
| `feature/refactor-shared-components` | Shared component cleanup |
| `feature/time-sync-filtering` | Camera time sync for events |
| `feature/ai-matching-rewrite` | AI photo matching — now shipped on `main` (AWS Rekognition + Inngest); branch is historical |

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
