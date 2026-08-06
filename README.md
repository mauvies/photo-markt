# Photo Markt

A sports-event photography marketplace. **Photographers** create events, upload photos and get paid;
**talent** (athletes, event-goers) find photos of themselves — by browsing, by selfie face search or
by bib number — and buy them.

Related docs: **[ARCHITECTURE.md](ARCHITECTURE.md)** (system diagrams, data model, money flows) ·
**[CLAUDE.md](CLAUDE.md)** (working conventions and the invariants behind them) ·
**[test/README.md](test/README.md)** (test conventions) · **[backlog/README.md](backlog/README.md)**
(ticket workflow) · **[docs/](docs/)** (deployment, monitoring, billing model, audits).

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Database**: Supabase (PostgreSQL) — raw SQL migrations in `supabase/migrations/`, no ORM
- **Auth**: Supabase Auth, Google OAuth only
- **Payments**: Stripe — photographer subscriptions, one-time purchases for talent, Connect transfers for payouts
- **Background jobs**: Inngest — face indexing, bib detection, thumbnails, storage cleanup, reconciliation, payout retries
- **AI matching**: AWS Rekognition (face collections + `DetectText` for bibs)
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York) + Radix UI
- **Forms**: TanStack React Form + Zod
- **Email**: Resend · **Monitoring**: Sentry (optional) · **Analytics**: Vercel
- **Tests**: Vitest (+ local Supabase via Docker for integration)
- **Linting/Formatting**: Biome (not ESLint/Prettier)

## Getting Started

### Prerequisites

- Node.js 22+ and pnpm 10 (what CI uses)
- A Supabase project (or the Supabase CLI + Docker for a local stack)
- A Stripe account (test mode) and the [Stripe CLI](https://stripe.com/docs/stripe-cli) — webhooks are
  **not optional** for anything billing-related (see below)
- Docker — only for `pnpm test:integration` / `pnpm db:start`
- AWS credentials with Rekognition access, if you want face/bib search to actually run

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create a `.env.local` at the project root. **`env.mjs` (T3 Env) is the validated source of truth** —
anything marked required there fails the boot if missing.

```env
# ── Supabase ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# ── Stripe ──────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...       # from `stripe listen`, NOT the dashboard's
STRIPE_PRICE_AMATEUR=price_...        # Starter plan, monthly
STRIPE_PRICE_PRO=price_...            # Pro plan, monthly
STRIPE_PRICE_AMATEUR_YEARLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...

# ── App ─────────────────────────────────────────────────────────────────────
SITE_URL=http://localhost:3000

# ── Email (Resend) ──────────────────────────────────────────────────────────
RESEND_API_KEY=re_...

# ── AWS Rekognition — face indexing/search + bib detection ──────────────────
AWS_REGION=eu-west-1                       # optional, defaults to eu-west-1
AWS_ACCESS_KEY_ID=<access-key-id>
AWS_SECRET_ACCESS_KEY=<secret-access-key>
REKOGNITION_COLLECTION_PREFIX=photomarkt   # optional, namespaces collections per env

# ── Inngest — background worker, served at /api/inngest ─────────────────────
INNGEST_EVENT_KEY=<event-key>
INNGEST_SIGNING_KEY=<signing-key>

# ── Optional ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=   # location autocomplete in event forms (falls back to mocks)
NEXT_PUBLIC_VERCEL_URL=              # base-URL resolution on preview deployments

# Face-search cost controls (T-034) — safe defaults, raise for a real event
FACE_SEARCH_GLOBAL_DAILY_CALLS=2000  # global/day circuit breaker (~$2/day)
FACE_SEARCH_EVENT_DAILY_CALLS=1000   # per-event/day cap
FACE_SEARCH_ALERT_EMAIL=             # 50%-of-global alert recipient; absent ⇒ no alert

REVEAL_TOKEN_SECRET=   # HMAC key for the reveal-gate cookie; falls back to the service-role key
HEALTH_CHECK_TOKEN=    # /api/health/ready stays 401 until this is set

# Sentry — all optional; the SDK is a no-op without a DSN
SENTRY_DSN=                 # server/edge DSN
NEXT_PUBLIC_SENTRY_DSN=     # browser DSN
SENTRY_ORG=                 # build-time, source-map upload only
SENTRY_PROJECT=             # build-time, source-map upload only
SENTRY_AUTH_TOKEN=          # build-time; source maps upload only when set
```

> The server-side `SUPABASE_URL` / `SUPABASE_ANON_KEY` checks in `env.mjs` are satisfied by the
> `NEXT_PUBLIC_SUPABASE_*` values above — you don't set those twice.

### 3. Run database migrations

Against a linked remote project:

```bash
supabase db push
```

Against the local Docker stack (also re-runs `supabase/seed.sql`, which grants the API roles the DML
permissions integration tests need):

```bash
pnpm db:start
pnpm db:reset
```

> In this repo, migrations reach **staging/production** through the `migrate.yml` GitHub Action on
> merge to `main` — not through Vercel. If that job is red, the migration did not land.

### 4. Start the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Run the Inngest worker locally (required for uploaded photos to appear)

> **This is not optional if you upload photos locally.** The Inngest worker does
> more than the AI pipeline — it also **promotes every upload from `pending` to
> `approved`** (`indexPhotoFaces` → `promote-upload-status`). Public event pages
> only show `approved` photos, so **without the worker running, freshly uploaded
> photos stay `pending` forever and the public event page shows 0 photos** — even
> though the photographer dashboard counts them. This happens **regardless of
> whether face recognition / bib detection are enabled**: those toggles only
> control the AWS calls; the approval step runs for every event. If you upload
> photos and they never go public (no Inngest runs), this is why.

`pnpm dev` alone does **not** start Inngest — it only serves the worker endpoint
at `/api/inngest`; nothing delivers events to it. You also can't exercise the
rest of the Inngest-driven pipeline (face indexing, thumbnail generation, bib
detection) end-to-end without it. `NEXT_PUBLIC_SUPABASE_URL`
in `.env.local` points at a **remote** Supabase project (staging), and
`INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` are shared with whatever Vercel
deployment is registered as the Inngest app. Without further setup,
`inngest.send()` calls from your local dev server are routed by **Inngest Cloud**
to that deployed endpoint — not to your machine — which downloads the uploaded
photo using **its own** environment's Supabase project. Since the photo was only
ever written to the project your local `.env.local` points to, the deployed
worker's download fails with `Object not found`. This is a **dev-only**
environment mismatch — production is unaffected, because the same production
deployment both uploads and processes photos with the same env vars.

To run the worker against your own machine, use the [Inngest Dev
Server](https://www.inngest.com/docs/local-development). Run it **alongside**
`pnpm dev`, in a second terminal:

```bash
pnpm dev           # terminal 1 — Next.js (serves /api/inngest)
pnpm dev:inngest   # terminal 2 — Inngest Dev Server, pointed at your local worker
```

`pnpm dev:inngest` is just `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`.
Open the Dev Server dashboard at [http://localhost:8288](http://localhost:8288)
to watch runs (`indexPhotoFaces`, thumbnails, bib detection, crons). With it
running, events sent from your local process are executed by your own
`/api/inngest` route — the same process that has the photo — so uploads,
approval, indexing, and thumbnail generation stay consistent end-to-end. Any
photos already stuck at `pending` get promoted as soon as the worker drains the
queue.

> If you rely on the SDK's automatic dev-mode discovery instead of the `-u`
> flag, set `INNGEST_DEV=1` in `.env.local` so it reaches `http://127.0.0.1:8288`.

### 6. Forward Stripe webhooks (required for anything billing-related)

Subscription activation, order creation and photographer payouts are **webhook-only by design**.
Stripe cannot reach `localhost`, so without a listener the flow *looks* broken in a very quiet way:
checkout succeeds, Stripe shows an `active` subscription, and the app still says Free.

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints its OWN whsec_…
# put that whsec_… in .env.local as STRIPE_WEBHOOK_SECRET, then restart `pnpm dev`
stripe events resend <evt_id>   # replay an event that fired while nothing was listening
```

The CLI's `whsec_` is **not** the dashboard's — a mismatch fails signature verification with a 400
and the webhook stays just as dead.

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start the development server |
| `pnpm dev:inngest` | Start the Inngest Dev Server (run alongside `pnpm dev`; required for uploads to be approved/processed locally) |
| `pnpm build` | Production build — **run it when touching `src/lib/` or `src/database/queries/`**: typecheck/lint/test don't bundle, so only the build catches server-only code (e.g. `sharp`) pulled into the client graph |
| `pnpm typecheck` | TypeScript type check (no emit) |
| `pnpm lint` / `pnpm lint:fix` | Biome check (with auto-fix) |
| `pnpm format` | Biome format with auto-fix |
| `pnpm test` | Run every test once (integration tests assume Supabase is already up) |
| `pnpm test:unit` | Unit tests only — no Docker, fast inner loop |
| `pnpm test:integration` | `supabase start` → run `test/integration` → `supabase stop` |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Run + write a coverage report under `coverage/` |
| `pnpm db:start` / `db:stop` | Boot / stop the local Supabase stack (Docker) |
| `pnpm db:reset` | Reset the local DB — re-runs migrations + `seed.sql` |
| `pnpm db:seed` | Re-run `supabase/seed.sql` via `psql` |
| `pnpm spell` | Spell check `.ts`/`.tsx` files |
| `pnpm advisors:check` | Supabase security advisors vs. the accepted baseline (needs `SUPABASE_ACCESS_TOKEN`) |
| `pnpm watermark:gen` | Regenerate the watermark tile asset |

## Project Structure

All application source lives under `src/` (Next.js' `src` directory convention); the repo root holds
only configs, docs, `public/`, and tests.

```
src/
  app/
    [lang]/             # every user-facing route is locale-prefixed (/es/... or /en/...)
      events/           # public event listing + detail (/events/[shareCode])
      photographer/     # public photographer profiles (/photographer/[slug])
      dashboard/
        photographer/   # events, uploads, sales & earnings, billing, payout profile
        talent/         # browse, saved photos, cart, orders
      cart/             # guest cart
      onboarding/ login/ signup/
      actions/          # cross-cutting Server Actions (roles, avatar, feedback, saved events)
    api/
      stripe/webhook/   # orders, transfers, subscriptions
      inngest/          # background-job worker — every function is registered here
      watermark/        # protected preview serving
      thumb/            # baked thumbnail serving
      events/[id]/download/  # purchased-photo ZIP
      admin/ health/
    auth/callback/      # Google OAuth code exchange
  components/           # shared UI (shadcn/ui + app components)
  hooks/                # shared React hooks
  database/
    queries/            # ALL Supabase queries, one file per domain, exported from index.ts
    server.ts           # server-side client (cookies)
    client.ts           # browser client
    supabase-admin.ts   # service-role client (bypasses RLS)
  dictionaries/         # i18n dictionaries (en.json, es.json)
  lib/                  # domain logic: pricing, payouts, AWS, Inngest functions, security helpers
  proxy.ts              # Next 16 middleware — refreshes auth sessions + locale detection
supabase/
  migrations/           # timestamped SQL migrations
  seed.sql              # local-only grants + seed data
test/                   # Vitest unit + integration tests
backlog/                # ticket queue and workflow
docs/                   # deployment, monitoring, billing model, audits
env.mjs                 # T3 Env schema — validates every env var
```

## How It Works

### Roles

Two roles, two dashboards: **Photographer** (`/dashboard/photographer` — events, uploads, sales,
earnings, payouts, subscription) and **Talent** (`/dashboard/talent` — browse, find photos of
yourself, cart, orders, saved photos).

Two columns, two meanings — **don't confuse them**:

- `user_role_memberships` is the **capability** — which roles a user actually holds. **Gate on this.**
- `profiles.active_role` is the **view preference** — which dashboard they last chose. It can
  legitimately point at a role the user does not hold.

`switchRole` only switches between roles you already hold; *gaining* a role is a separate explicit
action (`enablePhotographerRole` / `enableTalentRole`). Roles are self-service capabilities, not
privilege tiers — the initial one is assigned at onboarding. All of it lives in
`src/app/[lang]/actions/roles.ts` and returns typed results rather than throwing (Next redacts thrown
Server Action messages in production).

### Mutations and queries

**Server Actions for mutations** — colocated in `actions.ts` files next to their page. Don't add API
routes for mutations. **All Supabase queries live in `src/database/queries/`**, one file per domain,
never inline in a component or action.

### Photo pipeline

Upload → validated by magic bytes (`src/lib/photo-upload.ts`, never `file.type`) → stored in the
private `photos` bucket as `pending` → Inngest promotes it to `approved` after validating the bytes,
and in parallel bakes thumbnails, indexes faces and (if enabled) detects bib numbers. **Galleries
render `approved` only.** A run that dies before reaching a verdict settles the photo to `failed`
(recoverable — the owner can retry or discard); `rejected` means the bytes were bad and the object
was deleted.

Previews are protected: anything watermarked **or** for sale is served through `/api/watermark/`,
which picks the treatment server-side from the event — never from the caller. Full-resolution
originals only ever resolve as short-lived signed URLs after purchase. A photo that has been **sold
is never hard-deleted** — it's soft-deleted (`deleted_at`) so the buyer keeps access.

### Finding your photos

- **Face search** — the talent uploads a selfie; Rekognition `SearchFacesByImage` against the event's
  collection, results bucketed by confidence. Selfies are never persisted. Guarded by three tiered
  Postgres counters: per-`(event, IP)` throttle, per-event daily cap, and a global daily circuit
  breaker (all env-configurable).
- **Bib search** — per-event opt-in; `DetectText` on each photo, exact normalized match at search time.
- **Reveal gate** — an event can stay publicly discoverable while its photos are revealed *only* to a
  visitor who proves a face match. The proof is a signed, per-event cookie; enforcement lives at the
  listing paths, so photo IDs never reach an unproven visitor.

### Money

Photographers are on **Free** by default and can subscribe:

| Plan | Price | Sales commission | Storage | Events |
|---|---|---|---|---|
| Free | — | 8% | 20 GB | 5 |
| Starter | €9.99/mo · €95.88/yr | 4% | 50 GB | unlimited |
| Pro | €29.99/mo · €287.88/yr | 0% | 250 GB | unlimited |

`PLANS[].salesFeePercent` in `src/lib/plans.ts` is the single source of truth — the commission rates
derive from it and a test fails if the advertised copy drifts. Cancelling is `cancel_at_period_end`
(the photographer keeps the paid plan until the period they paid for ends); there is no Stripe
billing portal, and a downgrade never deletes anything — Free's limits only bind on the next write.

Buyers pay a **service fee** on top of the cart subtotal as its own visible Stripe line item —
**€0.25 + 3%**, computed only by `getBuyerServiceFeeCents` so the cart and the charge cannot diverge.
It is platform revenue and never touches photographer earnings. Priced events have a **€1.50 floor**
per photo (free events are exempt). Setting all three constants to 0 reverts to the pre-fee behaviour.

Photographers can offer **volume pricing**: a ladder of packages (`3 for €9`) and/or an
"all photos for one price" cap (Sportograf-style Foto-Flat). A bundle is a *price*, not a product —
the purchasable unit stays the photo — and the discounted total is split across the photos and
committed before Stripe is called, so a later price edit can't change what the buyer was charged.

**Payouts** go through Stripe Connect Express. A transfer fires per order in the
`payment_intent.succeeded` webhook; anything that couldn't be sent is written to the `payouts` ledger
with a `hold_reason` and drained by a retry cron. Photo Markt absorbs the Connect fee, so the
photographer always receives exactly their promised net.

### Everything else

- **i18n** — dictionaries in `src/dictionaries/{en,es}.json`. Every visible string goes in **both**;
  never hardcode.
- **Feature flags** — `src/lib/feature-flags.ts`. `AI_MATCHING` is enabled.
- **Background crons** — deliberately offset so they never contend: `0,30` storage cleanup ·
  `15,45` indexing reconciliation · `10,40` payout retries. Pick a fourth slot for a new one.
- **Security helpers** — use them, don't reinvent: `validatePhotoUpload` (uploads), `stringifyJsonLd`
  (JSON-LD in `dangerouslySetInnerHTML`), `rateLimit` (external-API and unauthenticated endpoints),
  `requireUser` (every dashboard segment — Next renders segments in parallel, so the parent guard
  doesn't stop a child), `safeNext` (redirect destinations from user input).

## Testing

Vitest, split in two so the fast loop needs no Docker:

```bash
pnpm test:unit          # test/unit — pure functions, mocked actions/components
pnpm test:integration   # test/integration — real local Supabase (boots and stops Docker for you)
```

Conventions (full version in [test/README.md](test/README.md)):

- **Every bug fix ships with a regression test** that fails before the fix and passes after.
- New features need tests on the critical paths — Server Actions, queries, payment flows, security
  helpers. UI polish can ship without component tests; payment/auth/data flow cannot.
- Choose the client deliberately: service-role to assert *query* behavior, anon/user-scoped to assert
  *RLS* behavior. Use `beforeEach(resetDatabase)` so ordering can't hide a failure.
- Mass `permission denied for table …` (`42501`) means the local API roles lost their grants — run
  `pnpm db:reset` once to re-apply `supabase/seed.sql`.

Coverage target is 60% on lines/branches/functions/statements; thresholds are informational until the
suite clears the bar.

## CI

| Workflow | Trigger | What it does |
|---|---|---|
| `test.yml` | every code PR (docs/backlog/specs ignored) | typecheck + lint + unit tests — no Docker |
| `test-integration.yml` | merge to `main`, daily 04:17 UTC, manual | boots local Supabase, runs `test/integration` |
| `migrate.yml` | merge to `main` touching `supabase/migrations/**` | applies pending migrations |
| `supabase-advisors.yml` | PRs touching `supabase/migrations/**` | fails on any advisor finding not in `scripts/advisors-baseline.ts` |

Run the integration suite on a branch before a risky merge:
`gh workflow run test-integration.yml --ref <branch>`.

## Workflow

Work is tracked in `backlog/` — see [backlog/README.md](backlog/README.md). **One branch = one ticket
= one draft PR.** Branch prefixes in use: `feat/`, `fix/`, `chore/`, `design/`. `main` is the only
source of truth for what shipped — never read a branch name as a feature's status.

## Deployment

The app runs on Vercel. See **[docs/deployment.md](docs/deployment.md)** for the production go-live
checklist: required environment variables, migrations, Stripe live mode, Resend domain verification,
security headers/CSP, and the post-deploy smoke test. Runtime alerting and health endpoints are in
**[docs/monitoring.md](docs/monitoring.md)**.
