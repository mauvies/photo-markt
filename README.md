# Photo Markt

A marketplace connecting photographers with athletes and event-goers. Photographers create events and upload photos; talent (athletes, models) browse and purchase photos of themselves.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Database**: Supabase (PostgreSQL) — raw SQL migrations, no ORM
- **Auth**: Supabase Auth with Google OAuth
- **Payments**: Stripe (subscriptions for photographers, one-time purchases for talent)
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York) + Radix UI
- **Forms**: TanStack React Form + Zod
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
STRIPE_PRICE_AMATEUR=price_...
STRIPE_PRICE_PRO=price_...

# App
SITE_URL=http://localhost:3000

# Email (Resend)
RESEND_API_KEY=re_...

# Optional: enables location autocomplete in event creation
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

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

```
app/                    # Next.js App Router pages and API routes
  [lang]/               # i18n layout
  api/                  # API routes (Stripe webhooks, watermark generation)
  auth/                 # Auth callback handlers
components/             # Shared UI components
database/
  queries/              # All Supabase query functions (one file per domain)
  server.ts             # Server-side Supabase client (cookie-based)
  client.ts             # Client-side Supabase client
lib/                    # Shared utilities, feature flags, AI providers
supabase/
  migrations/           # Timestamped SQL migration files
proxy.ts                # Next.js middleware — refreshes auth sessions
env.mjs                 # T3 Env schema — validates all env vars at runtime
```

## User Roles

The platform has two roles, stored as `active_role` on the `profiles` table:

- **Photographer** — creates events, uploads photos, tracks sales and earnings, subscribes to Amateur or Pro plans
- **Talent** — browses events, searches for photos of themselves, purchases individual photos

Users can switch roles. Initial role is assigned during onboarding (`app/actions/roles.ts`).

## Key Architectural Patterns

**Server Actions for mutations** — nearly all data mutations use `"use server"` actions colocated in `actions.ts` files next to their page. Avoid new API routes for mutations.

**Database query layer** — all Supabase queries live in `database/queries/` with a central export in `index.ts`. Add new queries there rather than inline in components.

**Feature flags** — controlled in `lib/feature-flags.ts`. AI photo matching (`AI_MATCHING`) is currently disabled.

**Image watermarking** — watermarked previews are served via `/app/api/watermark/`. Photos are stored in the `photos` Supabase Storage bucket.

## Stripe Setup

Photographers subscribe to one of two plans. Create the products/prices in your Stripe dashboard and add the price IDs to your env:

- `STRIPE_PRICE_AMATEUR` — Amateur plan price ID
- `STRIPE_PRICE_PRO` — Pro plan price ID

To receive webhooks locally, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Deployment

The app is deployed on Vercel. See the [project deployment notes](memory/project_deployment.md) for staging/prod setup details.
