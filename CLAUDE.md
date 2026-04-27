# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm lint         # Biome check (linting)
pnpm lint:fix     # Biome check with auto-fix
pnpm format       # Biome format with auto-fix
pnpm typecheck    # TypeScript type checking (no emit)
pnpm test         # Run tests (tsx --test __tests__/**/*.ts)
pnpm spell        # Spell check .ts/.tsx files
```

## Architecture Overview

**Photo Markt** is a marketplace connecting photographers with athletes/event-goers. Photographers create events and upload photos; talent (athletes/models) browse and purchase photos of themselves.

### Tech Stack

- **Framework**: Next.js App Router with React 19, TypeScript
- **Database**: Supabase (PostgreSQL) — raw SQL migrations, no ORM
- **Auth**: Supabase Auth with Google
- **Payments**: Stripe (subscriptions for photographers, photo purchases for talent)
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York style) + Radix UI
- **Forms**: TanStack React Form + Zod validation
- **Linting/Formatting**: Biome (not ESLint/Prettier)

### Role-Based System

Two user roles with separate dashboards:
- **PHOTOGRAPHER** (`/dashboard/photographer`) — manages events, uploads photos, tracks earnings/sales
- **TALENT** (`/dashboard/talent`) — browses events, searches for photos of themselves, purchases photos

Role is stored in the `profiles` table as `active_role`. Users can switch roles. Onboarding assigns initial role via `/app/actions/roles.ts`.

### Key Architectural Patterns

**Server Actions for mutations**: Nearly all data mutations use `"use server"` actions colocated in `actions.ts` files next to their page components. Avoid creating new API routes for mutations.

**Database query layer**: All Supabase queries live in `/database/queries/`. Each domain has its own file (events, photos, orders, etc.) with a central export in `index.ts`. Always add queries here rather than inline in components or actions.

**Session middleware**: `proxy.ts` (Next.js middleware) refreshes Supabase auth sessions on every request. The server Supabase client is in `database/server.ts` (cookie-based), the client-side in `database/client.ts`.

**Feature flags**: Controlled in `lib/feature-flags.ts`. AI matching (`AI_MATCHING`) is currently disabled.

**Environment validation**: `env.mjs` uses T3 Env (Zod) to validate all environment variables at build/runtime. Add new env vars here.

### Database

Migrations are in `/supabase/migrations/` (timestamp-prefixed SQL files). Key tables: `profiles`, `events`, `photos`, `orders`, `carts`, `cart_items`, `sales`, `earnings`, `payment_accounts`, `subscriptions`, `talent_library`, `ai_search_profiles`, `ai_search_usage`.

Events support soft delete (deleted_at column). Photos have embedding columns for future AI vector search.

### Payments

- Photographers subscribe to Amateur or Pro plans (Stripe subscriptions, price IDs in env)
- Talent purchases individual photos (Stripe one-time payments)
- Payout system tracks photographer earnings and payment accounts
- Stripe webhook handling in `/app/api/stripe/`

### AI Photo Search

Currently uses a mock embedding provider (`lib/ai/embedding-provider.ts`). The infrastructure (vector columns, similarity search RPC functions, rate limiting) is in place for real models. `AI_MATCHING` feature flag must be enabled to expose this to users.

### Image Handling

Photos are stored in Supabase Storage (bucket: `photos`). Watermarked previews are generated via `/app/api/watermark/`. Next.js Image optimization is configured for Supabase storage URLs and localhost.
