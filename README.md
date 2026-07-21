# Photo Markt

A marketplace connecting photographers with athletes and event-goers. Photographers create events and upload photos; talent (athletes, models) browse and purchase photos of themselves.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Database**: Supabase (PostgreSQL) — raw SQL migrations, no ORM
- **Auth**: Supabase Auth with Google OAuth
- **Payments**: Stripe (subscriptions for photographers, one-time purchases for talent, Connect for payouts)
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York) + Radix UI
- **Forms**: TanStack React Form + Zod
- **AI matching**: AWS Rekognition (face indexing/search) run via Inngest background jobs
- **Linting/Formatting**: Biome

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- A Supabase project
- A Stripe account

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create a `.env.local` file at the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_AMATEUR=price_...          # Starter plan, monthly
STRIPE_PRICE_PRO=price_...              # Pro plan, monthly
STRIPE_PRICE_AMATEUR_YEARLY=price_...   # Starter plan, yearly
STRIPE_PRICE_PRO_YEARLY=price_...       # Pro plan, yearly

# App
SITE_URL=http://localhost:3000

# Email (Resend)
RESEND_API_KEY=re_...

# AWS Rekognition — face indexing/search for AI photo matching
AWS_REGION=eu-west-1                       # optional, defaults to eu-west-1
AWS_ACCESS_KEY_ID=<access-key-id>
AWS_SECRET_ACCESS_KEY=<secret-access-key>
REKOGNITION_COLLECTION_PREFIX=photomarkt   # optional, namespaces collections per env

# Inngest — background worker that runs face indexing (served at /api/inngest)
INNGEST_EVENT_KEY=<event-key>
INNGEST_SIGNING_KEY=<signing-key>

# Optional: enables location autocomplete in event creation
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=

# Sentry error monitoring — all optional; the SDK is a no-op without a DSN
SENTRY_DSN=                 # server/edge DSN
NEXT_PUBLIC_SENTRY_DSN=     # browser DSN
SENTRY_ORG=                 # build-time, source-map upload only
SENTRY_PROJECT=             # build-time, source-map upload only
SENTRY_AUTH_TOKEN=          # build-time; source maps upload only when set
```

> The full validated schema lives in `env.mjs` (T3 Env). The server-side
> `SUPABASE_URL` / `SUPABASE_ANON_KEY` checks are satisfied by the
> `NEXT_PUBLIC_SUPABASE_*` values above, so you don't set those twice.

### 3. Run database migrations

```bash
supabase db push
```

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

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm dev:inngest` | Start the Inngest Dev Server (run alongside `pnpm dev`; required for uploaded photos to be approved/processed locally) |
| `pnpm build` | Production build |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome check with auto-fix |
| `pnpm format` | Biome format with auto-fix |
| `pnpm typecheck` | TypeScript type check (no emit) |
| `pnpm test` | Run tests |
| `pnpm spell` | Spell check `.ts`/`.tsx` files |

## Project Structure

All application source lives under `src/` (Next.js' `src` directory convention); the repo root holds only configs, docs, `public/`, and tests.

```
src/                    # All application source code
  app/                  # Next.js App Router pages and API routes
    [lang]/             # i18n layout
    api/                # API routes (Stripe webhooks, watermark generation)
    auth/               # Auth callback handlers
  components/           # Shared UI components
  hooks/                # Shared React hooks
  database/
    queries/            # All Supabase query functions (one file per domain)
    server.ts           # Server-side Supabase client (cookie-based)
    client.ts           # Client-side Supabase client
  dictionaries/         # i18n dictionaries (en.json, es.json)
  lib/                  # Shared utilities, feature flags, AI providers
  proxy.ts              # Next.js middleware — refreshes auth sessions
supabase/
  migrations/           # Timestamped SQL migration files
test/                   # Vitest unit + integration tests
env.mjs                 # T3 Env schema — validates all env vars at runtime
```

## User Roles

The platform has two roles, stored as `active_role` on the `profiles` table:

- **Photographer** — creates events (including collaborative events with guest uploads and invited photographers), uploads photos, tracks sales and earnings, manages payouts, subscribes to the Free, Starter, or Pro plan
- **Talent** — browses events, searches for photos of themselves (including AI face search), purchases individual photos

Users can switch roles. Initial role is assigned during onboarding (`src/app/[lang]/actions/roles.ts`).

## Key Architectural Patterns

**Server Actions for mutations** — nearly all data mutations use `"use server"` actions colocated in `actions.ts` files next to their page. Avoid new API routes for mutations.

**Database query layer** — all Supabase queries live in `src/database/queries/` with a central export in `index.ts`. Add new queries there rather than inline in components.

**Feature flags** — controlled in `src/lib/feature-flags.ts`. AI photo matching (`AI_MATCHING`) is enabled; it indexes faces with AWS Rekognition via Inngest background jobs and lets talent find themselves with a selfie search.

**Image watermarking** — watermarked previews are served via `/app/api/watermark/`. Photos are stored in the `photos` Supabase Storage bucket.

## Stripe Setup

Photographers are on the **Free** plan by default (12% commission) and can subscribe to **Starter** (8%) or **Pro** (5%). Create the paid products/prices in your Stripe dashboard and add the price IDs to your env:

- `STRIPE_PRICE_AMATEUR` / `STRIPE_PRICE_AMATEUR_YEARLY` — Starter plan price IDs (the `AMATEUR` name is the legacy env key for the Starter tier)
- `STRIPE_PRICE_PRO` / `STRIPE_PRICE_PRO_YEARLY` — Pro plan price IDs

To receive webhooks locally, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Deployment

The app is deployed on Vercel. See **[docs/deployment.md](docs/deployment.md)** for the
full production go-live checklist: required environment variables, database
migrations, Stripe live-mode, Resend domain verification, security headers/CSP,
and the post-deploy smoke test.
