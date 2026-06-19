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

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
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

The app is deployed on Vercel. See the [project deployment notes](memory/project_deployment.md) for staging/prod setup details.
