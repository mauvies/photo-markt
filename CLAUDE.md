# CLAUDE.md

This file provides guidance to Claude Code when working with the Photo Markt codebase.

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm lint         # Biome check (linting)
pnpm lint:fix     # Biome check with auto-fix
pnpm format       # Biome format with auto-fix
pnpm typecheck    # TypeScript type checking (no emit)
pnpm test         # Run all Vitest tests once
pnpm test:watch   # Vitest watch mode
pnpm test:coverage # Vitest run + coverage report
pnpm db:start     # supabase start (Docker; local Supabase for integration tests)
pnpm db:stop      # supabase stop
pnpm db:reset     # supabase db reset (re-runs migrations + seed.sql)
pnpm db:seed      # Re-run supabase/seed.sql via psql
pnpm spell        # Spell check .ts/.tsx files
```

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
- **i18n**: Custom dictionary system (`/dictionaries/en.json`, `/dictionaries/es.json`)

## Architecture

### Routing

```
app/
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

Role is stored in `profiles.active_role`. Users can switch roles. Initial role assigned during onboarding via `/app/actions/roles.ts`.

### Key Architectural Patterns

**Server Actions for mutations**
All data mutations use `"use server"` actions in `actions.ts` files colocated next to their page components. Do not create new API routes for mutations — use server actions instead.

**Database query layer**
All Supabase queries live in `/database/queries/`. Each domain has its own file. Always add new queries here — never inline in components or actions.

```
database/queries/
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
- Server-side (Server Components, Server Actions, API routes): `database/server.ts`
- Client-side (Client Components): `database/client.ts`
- Admin (service role, bypasses RLS): `database/supabase-admin.ts`

**Middleware**
`proxy.ts` (Next.js middleware) refreshes Supabase auth sessions on every request and handles locale detection.

**i18n**
- Dictionaries: `/dictionaries/en.json` and `/dictionaries/es.json`
- Server-side: `lib/i18n/get-dictionary.ts`
- Client-side: `lib/i18n/translations-provider.tsx` + `useTranslations()` hook
- Always add new strings to both dictionaries. Never hardcode visible strings.

**Feature flags**
Controlled in `lib/feature-flags.ts`. `AI_MATCHING` is currently disabled.

**Environment validation**
`env.mjs` uses T3 Env (Zod). Always add new environment variables here.

## Database Schema

### Key Tables

**events**
`id, user_id, name, date, start_date, end_date, city, country, state, activity, is_public, share_code, price_per_photo, watermark_enabled, slug, lat, lng, time_offset, time_sync_enabled, deleted_at, created_at, updated_at`
- Soft delete via `deleted_at`
- `state` field tracks event status (`upcoming` / `completed`) based on date
- `time_sync_enabled` + `time_offset` support the camera time sync feature
- `share_code` allows access to private events

**photos** (via `/database/queries/photos.ts`)
- Has embedding columns for future AI vector search
- Stored in Supabase Storage bucket: `photos`
- Watermarked previews served via `/app/api/watermark/`
- Full resolution only accessible via short-lived signed URLs after purchase

**carts / cart_items**
`carts: id, user_id` — `cart_items: id, cart_id, photo_id, photographer_id, unit_price_cents`
- Guest cart stored in `localStorage` under `picdemi_guest_cart`
- Guest cart merged into authenticated cart on login via `components/guest-cart-merge.tsx`

**orders / order_items**
`orders: id, user_id, cart_id, stripe_payment_intent_id, stripe_checkout_session_id, status, total_amount_cents`
- Status: `pending`, `completed`, `failed`, `refunded`

**payment_accounts**
`id, photographer_id, type, account_details, is_default, is_verified`
- Stores Stripe Connect account info for photographer payouts

**payouts**
`id, photographer_id, amount_cents, status, paid_at`
- Automatic weekly payouts via Stripe Connect ($25 minimum threshold)

**ai_search_profiles**
`id, user_id, selfie_embedding, activity_type, country, region, date_from, date_to`
- Stores talent selfie embeddings for AI photo matching (currently disabled)

**admin_users**
`user_id, granted_at, granted_by`
- Service-role-only access (RLS enabled, no policies — `anon`/`authenticated` cannot read or write)
- Used by `/api/admin/*` endpoints to gate access. Look up via `supabaseAdmin`, never via the user-scoped client
- Seed admins via direct DB access (Supabase SQL editor): `insert into admin_users (user_id) values ('<uuid>')`

**rate_limit_buckets**
`bucket_key, window_start, count`
- Service-role-only access (RLS enabled, no policies)
- Backs `lib/rate-limit.ts`. Atomic increments via the `increment_rate_limit_bucket` `SECURITY DEFINER` function — EXECUTE explicitly revoked from `anon` and `authenticated`
- One row per `(bucket_key, window_start)`. No automatic cleanup yet — fine at current scale

## Payments

### Photographer Subscriptions
Three plans: **Free** (12% commission), **Starter** ($14.99/mo, 8% commission), **Pro** ($29.99/mo, 5% commission).
Price IDs in env: `STRIPE_PRICE_AMATEUR`, `STRIPE_PRICE_PRO`.
Billing management in `/dashboard/photographer/settings/`.

### Photo Purchases (Talent)
One-time Stripe payments. Webhook handler at `/app/api/stripe/webhook/route.ts`.
After confirmed payment: order saved, cart cleared, photos available in talent profile and orders.

### Photographer Payouts (Stripe Connect)
- Photographers connect Stripe Express accounts in `/dashboard/photographer/profile/payout-profile/`
- Photo Markt absorbs the Stripe Connect fee (0.5%) — photographer always receives exactly their promised net amount
- Automatic weekly payouts, $25 minimum threshold
- Sales tracked in `/dashboard/photographer/sales/`, earnings in `/dashboard/photographer/ganancias/`

## Shared Components

```
components/
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

The `PhotoActionIcon` component (`components/ui/photo-action-icon.tsx`) is the standard for all photo action buttons:
- **Style:** Dark semi-transparent background (`bg-gray-900/60 backdrop-blur-sm`), white icon
- **States:** Outline icon = inactive, filled icon = active. No color changes — only outline vs filled.
- **Visibility:** Always visible on mobile, visible on hover on desktop (handled by parent with `group` + `md:opacity-0 md:group-hover:opacity-100`)
- **Tooltip:** Always included via Shadcn `Tooltip`
- **Used in:** `/events/[slug]`, `/dashboard/photographer/events/[id]`, `/dashboard/talent/events/[id]`, `/dashboard/talent/photos`, `/dashboard/talent/profile`

## Event Search

Search bar (`components/event-search-bar/`) queries Supabase directly — no external APIs:
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
- Previews: watermarked + degraded quality via `/app/api/watermark/`
- Purchased photos: short-lived signed URLs — never expose original storage path publicly
- Watermark: tiled repeating pattern, server-side via Sharp
- **Uploads:** all paths (photographer + guest collaborative) validate via `lib/photo-upload.ts` before writing to storage. Magic-byte check via Sharp, 50 MB per-file cap, content-type and extension are derived from the detected format — `file.type` and `file.name` are never trusted

## Security Utilities

The `lib/` modules below enforce conventions across the app. Use them — don't reinvent.

**`lib/photo-upload.ts`** — `validatePhotoUpload(file)`
Reads magic bytes via Sharp, rejects unknown formats, caps per-file size at 50 MB. Returns `{ buffer, contentType, extension }` derived from the detected format. Apply on every upload path before writing to storage.

**`lib/json-ld.ts`** — `stringifyJsonLd(value)`
Use this instead of `JSON.stringify` whenever embedding structured data in an inline `<script>` via `dangerouslySetInnerHTML`. Escapes `<`, `>`, `&`, U+2028, U+2029 so a user-supplied field containing `</script>` cannot break out of the script block.

**`lib/rate-limit.ts`** — `rateLimit({ key, limit, windowSec })`
Postgres-backed fixed-window limiter. Apply to:
- Endpoints that hit external APIs (Stripe, Resend) on every call
- Endpoints with sequential or guessable id parameters (admin endpoints)
- Unauthenticated endpoints with side effects (guest uploads)

Helpers: `getClientIp(headers)` for unauthenticated keying, `retryAfterSeconds(result)` for the `Retry-After` response header. Fails open on backend errors. Backend is pluggable via the `RateLimitBackend` type — currently Postgres, swappable to Upstash/Redis later without touching call sites.

**`lib/auth/safe-next.ts`** — `safeNext(value)`
Use for any redirect destination derived from user input (`?next=`, OAuth callback, etc). Rejects protocol-relative URLs (`//evil.com`), backslash variants, and control characters.

## Testing

The project uses **Vitest** for tests and **Supabase local** (Docker) for integration tests that need a real database. Detailed conventions and debugging tips live in [`test/README.md`](./test/README.md).

### Commands

| Command | What it does |
|---|---|
| `pnpm test` | Run every test once |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Run + write coverage report under `coverage/` |
| `pnpm db:start` / `db:stop` / `db:reset` | Boot or reset the local Supabase stack (Docker required) |

### Directory layout

```
test/
  unit/                # Pure functions — no DB, no mocks
  integration/         # Hit local Supabase via test helpers
  helpers/
    supabase-test-client.ts   # createTestUser / createTestEvent / createTestPhoto / resetDatabase
__tests__/             # Older unit tests (also discovered by Vitest)
```

Vitest discovers any file matching `**/*.test.ts(x)` or `**/__tests__/**/*.ts`.

### Conventions

- **Every bug fix should ship with a regression test.** The test should fail before the fix and pass after.
- **Every new feature should include tests for the critical paths** — Server Actions, queries, payment flows, security helpers. UI polish can ship without component tests for now; payment/auth/data flow cannot.
- **Choose the right client deliberately** in integration tests: service-role to assert *query behavior*, anon/user-scoped to assert *RLS behavior*. Helpers in `test/helpers/supabase-test-client.ts` make both easy.
- **Use `beforeEach(resetDatabase)`** in integration tests so ordering can't quietly pass or fail one.
- **Keep helpers pure where possible** — pure functions are testable without a DB and make unit tests cheap to write.

### Coverage target

The goal is **60% on lines, branches, functions, and statements**. Thresholds are not enforced in `vitest.config.ts` yet — the report is informational until we've written enough tests to clear the bar. Flip the gate on (uncomment `thresholds:` in the config) when ready.

## AI Photo Search

Infrastructure in place (vector columns, similarity search RPC, rate limiting) but disabled behind `AI_MATCHING` feature flag. Mock provider in `lib/ai/embedding-provider.ts`. Planned: CLIP or InsightFace for outfit pattern recognition.

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
STRIPE_PRICE_AMATEUR=        # Starter plan price ID
STRIPE_PRICE_PRO=            # Pro plan price ID
PLATFORM_FEE_BPS=            # Platform fee in basis points

# Google
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=   # Places API — event location forms only

# AI (optional, feature-flagged)
EMBEDDING_PROVIDER=
HUGGINGFACE_API_KEY=
REPLICATE_API_TOKEN=
AI_PROVIDER=

# Email
RESEND_API_KEY=
RESEND_FROM_EMAIL=

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
| `feature/ai-matching-rewrite` | AI photo matching (disabled) |

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
- All Supabase queries go in `/database/queries/`
- All mutations use Server Actions — not API routes
- Use existing Shadcn components — do not introduce new UI libraries
- Use Biome for formatting — not Prettier
- New env vars must be added to `env.mjs`
- No `any` types in TypeScript
- All async functions must have proper error handling — no silent catches
- New features should include tests for critical logic (Server Actions, queries, payment flows). Bug fixes should include a regression test that fails before the fix and passes after

### Security Conventions
- File uploads must validate via `lib/photo-upload.ts` — never trust client-supplied MIME or extension
- JSON-LD inside `dangerouslySetInnerHTML` must use `stringifyJsonLd` — never raw `JSON.stringify`
- Admin endpoints check `admin_users` via `supabaseAdmin` — there is no `profiles.is_admin` column
- New `SECURITY DEFINER` functions in the `public` schema must explicitly `revoke execute ... from anon, authenticated` — Supabase grants those by default and `revoke from public` doesn't override role-specific grants
- Tables with no public access pattern: enable RLS with no policies, use `supabaseAdmin` only — see `admin_users` and `rate_limit_buckets` for the pattern
- Redirect destinations from user input must go through `safeNext()` from `lib/auth/safe-next.ts`
- Permissive RLS policies (`USING (true)`) are forbidden on tables with sensitive writes — service-role bypasses RLS, so the webhook/admin paths still work after locking down user-facing roles
