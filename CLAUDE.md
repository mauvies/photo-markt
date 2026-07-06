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

To keep commands auto-approvable and avoid manual permission prompts, follow these rules when running shell commands:

- Prefer simple, atomic commands. Run one operation per command instead of chaining multiple with `&&`.
- Do NOT use `cd` to change directories before running a command. Compound commands starting with `cd` plus output redirection require mandatory manual approval (path-resolution bypass protection) and cannot be pre-approved.
- Always use full paths from the repository root instead of `cd`-ing into a subdirectory. For example, use `grep -n "export" src/components/ui/dialog.tsx` rather than `cd src && grep -n "export" components/ui/dialog.tsx`.
- When inspecting multiple files, run separate individual commands rather than chaining them into one compound command.
- Avoid unnecessary output redirection (`2>/dev/null`, etc.) and piping inside compound commands when a simpler single command achieves the same result.
- These conventions keep each command matching the pre-approved allowlist, so tasks run without pausing for approval.

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
- **Background jobs**: Inngest (face indexing, thumbnail generation, storage cleanup) served at `/api/inngest`
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
`id, user_id, name, date, start_date, end_date, city, country, state, activity, is_public, share_code, price_per_photo, watermark_enabled, slug, lat, lng, time_offset, time_sync_enabled, deleted_at, created_at, updated_at`
- Soft delete via `deleted_at`
- `state` field tracks event status (`upcoming` / `completed`) based on date
- `time_sync_enabled` + `time_offset` support the camera time sync feature
- `share_code` allows access to private events

**photos** (via `/src/database/queries/photos.ts`)
- `face_index_status` (`pending`/`indexing`/`indexed`/`failed`/`no_faces`/`not_applicable`) and `thumbnail_status` track the Inngest jobs; `width`/`height` persisted for layout
- Stored in Supabase Storage bucket: `photos`
- Watermarked previews served via `/src/app/api/watermark/`
- Full resolution only accessible via short-lived signed URLs after purchase

**photo_faces** (via `/src/database/queries/rekognition.ts`)
`photo_id, aws_face_id, aws_collection_id, confidence, bounding_box, indexed_at`
- One row per face AWS Rekognition indexes in a photo; unique on `(photo_id, aws_face_id)`
- Face embeddings themselves live inside the AWS collection — the DB only stores the returned `aws_face_id`. Talent selfie search maps AWS face IDs back to photo IDs here

**carts / cart_items**
`carts: id, user_id` — `cart_items: id, cart_id, photo_id, photographer_id, unit_price_cents`
- Guest cart stored in `localStorage` under `photo-markt_guest_cart`
- Guest cart merged into authenticated cart on login via `src/components/guest-cart-merge.tsx`

**orders / order_items**
`orders: id, user_id, cart_id, stripe_payment_intent_id, stripe_checkout_session_id, status, total_amount_cents`
- Status: `pending`, `completed`, `failed`, `refunded`

**payment_accounts**
`id, photographer_id, type, account_details, is_default, is_verified`
- Stores Stripe Connect account info for photographer payouts

**payouts**
`id, photographer_id, amount_cents, status, paid_at`
- Transfers fire **per order**, synchronously in the Stripe webhook on `payment_intent.succeeded` (one per `(order_item, photographer)`); this table is the historical record. There is no payout cron or minimum threshold. A manual admin-approval path also exists via `/api/admin/payouts/[id]`. See `ARCHITECTURE.md` §4.3

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
Three plans: **Free** (12% commission), **Starter** ($14.99/mo, 8% commission), **Pro** ($29.99/mo, 5% commission).
Price IDs in env: `STRIPE_PRICE_AMATEUR`, `STRIPE_PRICE_PRO`.
Billing management in `/dashboard/photographer/settings/`.

### Photo Purchases (Talent)
One-time Stripe payments. Webhook handler at `/src/app/api/stripe/webhook/route.ts`.
After confirmed payment: order saved, cart cleared, photos available in talent profile and orders.

### Photographer Payouts (Stripe Connect)
- Photographers connect Stripe Express accounts in `/dashboard/photographer/profile/payout-profile/`
- Photo Markt absorbs the Stripe Connect fee (0.5%) — photographer always receives exactly their promised net amount
- Transfers fire per order, synchronously in the `payment_intent.succeeded` webhook handler — there is no cron or minimum threshold (see `ARCHITECTURE.md` §4.3)
- Sales tracked in `/dashboard/photographer/sales/`, earnings in `/dashboard/photographer/ganancias/`

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
- Previews: watermarked + degraded quality via `/src/app/api/watermark/`
- Purchased photos: short-lived signed URLs — never expose original storage path publicly
- Watermark: tiled repeating pattern, server-side via Sharp
- **Uploads:** all paths (photographer + guest collaborative) validate via `src/lib/photo-upload.ts` before writing to storage. Magic-byte check via Sharp, 50 MB per-file cap, content-type and extension are derived from the detected format — `file.type` and `file.name` are never trusted

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
- **Rate limits**: the only limiter is a per-`(shareCode, IP)` cap of 10 searches/hour (`src/lib/rate-limit.ts`). There is **no per-plan monthly search quota** — a half-built version (the `ai_search_usage` table + an `AI_SEARCH_RATE_LIMITS` config) was removed in T-036 because face search is anonymous-friendly (the searcher isn't the plan owner), so a per-plan monthly meter never fit. An abuse-resistant, cost-controlled model is being re-designed under ticket T-034. Don't re-advertise a "N searches/month" number until that lands.
- **Worker route:** all Inngest functions are registered at `/src/app/api/inngest/route.ts`.

## BIB number recognition (T-032)

Race **bib-number** detection, **per-event opt-in** (the cost gate, mirroring `ai_matching_enabled`). Shares the Rekognition client + Inngest + `safeCall` conventions with face matching.

- **Opt-in:** `events.bib_detection_enabled` (default false) + `bib_detection_status`. Photographer toggles it on the event detail page (`enable/disableBibDetectionForEvent`, owner-only); enabling fires `event.bib-detection-enabled` → `backfillEventBibDetection`. Disabled for `contains_minors` events (parity with face search). Disabling **keeps** existing bib rows.
- **Detection (job):** `detectPhotoBibs` (`src/lib/inngest/functions/detect-photo-bibs.ts`) on `photo.uploaded` + `photo.bib-detect`; no-ops (status stays NULL) unless the event opted in. Downloads the image, calls Rekognition `DetectText` (`src/lib/aws/bib-detection.ts`), filters to plausible bibs (`extractBibCandidates` in `src/lib/bib-numbers.ts` — confidence floor + digit-dominant pattern + dedupe + cap), persists to `photo_bib_numbers`. Bytes never cross Inngest step boundaries; AWS/Storage/Sharp wrapped in `safeCall`. Backfill fans out a **bib-specific** `photo.bib-detect` event so it never re-runs the face/thumbnail jobs.
- **Persistence:** `photo_bib_numbers` (`photo_id`, `bib_text`, `confidence`, `bounding_box`, unique `(photo_id, bib_text)`) — RLS read like `photo_faces`, service-role writes only. Per-photo `photos.bib_detection_status`. Queries in `src/database/queries/bib-numbers.ts`.
- **Search (talent):** `searchPhotosByBibInEvent(shareCode, bib)` (`events/[shareCode]/actions.ts`) — exact normalized match, rate-limited `(shareCode, IP)` 30/h, returns matching **public** photo ids. Surfaced via `BibSearchBar` on both the public event gallery (`/events/[shareCode]`) and the talent-dashboard event view (`/dashboard/talent/events/[id]`), gated on `bib_detection_enabled`; filters the grid client-side. Enabling/disabling bib detection busts the public/talent event cache tags (`revalidateEventPhotoCacheTags`) so the bar appears/disappears immediately (T-064).
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
