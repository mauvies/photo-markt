# Photo Markt — Architecture

Living architecture reference. Each section pairs a Mermaid diagram with a short
prose intro. Anything not yet implemented is explicitly marked **PLANNED** or
**DISABLED**.

Source of truth: actual migrations in `supabase/migrations/`, query layer in
`database/queries/`, routes in `app/[lang]/`, feature flags in
`lib/feature-flags.ts`. CLAUDE.md is supplementary; this document corrects it
where the code disagrees (e.g. "weekly payout cron" is aspirational — payouts
fire per-order on the Stripe webhook).

---

## 1. System context

Three user types interact with one Next.js app, which fans out to a handful of
external systems. Stripe and Supabase carry the load; the rest are
single-purpose integrations. The AI provider edge is dotted because it is
**PLANNED** — no production traffic flows there today.

```mermaid
flowchart LR
  Photographer((Photographer))
  Talent((Talent))
  Guest((Guest))

  App["Photo Markt<br/>Next.js 16 on Vercel"]

  Supabase[("Supabase<br/>Postgres + Auth + Storage")]
  Stripe["Stripe<br/>Checkout · Subscriptions · Connect"]
  Resend["Resend<br/>Transactional email"]
  Google["Google OAuth"]
  GMaps["Google Maps Places API"]
  Replicate["Replicate / CLIP<br/>PLANNED"]

  Photographer --> App
  Talent --> App
  Guest --> App

  App --> Supabase
  App --> Stripe
  App --> Resend
  App -->|sign-in| Google
  App -->|location autocomplete| GMaps
  App -.->|embeddings| Replicate

  Stripe -->|webhooks| App
  Google -->|OAuth callback| App
```

---

## 2. Application architecture

Inside the app, four layers serve traffic: the browser, Next.js middleware,
the App Router (RSC + Client Components + Server Actions + API routes), and
the domain query layer. The query layer is the only place that talks to
Supabase — every other layer routes through it. Three distinct Supabase
client constructors enforce trust boundaries: anon (client-side, RLS),
authenticated (server-side, RLS), service role (admin-only, bypasses RLS).

```mermaid
flowchart TB
  Browser["Browser<br/>Client Components · TanStack Query · localStorage cart"]

  Middleware["proxy.ts<br/>Supabase session refresh + i18n locale detect"]

  subgraph AppRouter["Next.js App Router"]
    RSC["React Server Components<br/>page.tsx · layout.tsx"]
    Actions["Server Actions<br/>'use server' files"]
    ApiRoutes["API Routes<br/>app/api/* (Stripe webhook, watermark, admin)"]
  end

  Queries["database/queries/*<br/>Domain query layer (events, photos, carts, ...)"]

  ClientSb["database/client.ts<br/>anon JWT · RLS enforced"]
  ServerSb["database/server.ts<br/>user JWT · RLS enforced"]
  AdminSb["database/supabase-admin.ts<br/>service role · bypasses RLS"]

  Supabase[("Supabase<br/>Postgres + Storage")]

  Browser -->|HTTP request| Middleware
  Middleware --> RSC
  Browser -->|server-action invocation| Actions
  Browser -->|fetch| ApiRoutes
  Browser -.->|few client-side reads| ClientSb

  RSC --> Queries
  Actions --> Queries
  ApiRoutes --> Queries

  Queries --> ServerSb
  Queries --> AdminSb

  ClientSb --> Supabase
  ServerSb --> Supabase
  AdminSb --> Supabase
```

Conventions enforced by this layout (see `CLAUDE.md`):

- **All mutations go through Server Actions**, not API routes. API routes are
  reserved for things that must be addressable HTTP endpoints (Stripe
  webhook, watermark CDN-style URL, admin endpoints).
- **Service role is used only when RLS would block a legitimate operation**
  (Stripe webhook writes, admin endpoints, watermark API, embedding writes).
  Every other path uses the user-scoped client so RLS catches mistakes.

---

## 3. Database schema (ER diagram)

The schema separates clearly into three concerns: identity (`profiles`,
`admin_users`, `subscriptions`), commerce (`carts → orders → payouts`), and
AI (`ai_search_profiles`, `photo_embeddings`). All `*_id` FKs to "users" are
to Supabase's built-in `auth.users` table (shown collapsed onto `profiles`
since `profiles.id` is a 1:1 FK to it). Auxiliary tables like
`talent_photo_tags`, `rate_limit_buckets`, `download_tokens`, `guest_orders`,
`event_photographers`, `time_sync_tokens`, `user_roles`, `feedback`, and
`pending_guest_checkouts` exist in the migrations but are omitted here to
keep the diagram readable — they're described in prose below.

```mermaid
erDiagram
  PROFILES ||--o{ EVENTS : owns
  PROFILES ||--o| SUBSCRIPTIONS : "subscribes (1:1)"
  PROFILES ||--o{ PAYMENT_ACCOUNTS : "configures"
  PROFILES ||--o{ PAYOUTS : "receives"
  PROFILES ||--o{ CARTS : has
  PROFILES ||--o{ ORDERS : places
  PROFILES ||--o{ AI_SEARCH_PROFILES : "saved searches"
  PROFILES ||--o| ADMIN_USERS : "may be admin"

  EVENTS ||--o{ PHOTOS : contains

  PHOTOS ||--o{ CART_ITEMS : in
  PHOTOS ||--o{ ORDER_ITEMS : purchased_in
  PHOTOS ||--o| PHOTO_EMBEDDINGS : "vectorized (1:1)"

  CARTS ||--o{ CART_ITEMS : holds
  CARTS ||--o{ ORDERS : "checked out as"

  ORDERS ||--o{ ORDER_ITEMS : "line items"

  PROFILES {
    uuid id PK
    text username UK
    text display_name
    text bio
    enum active_role "PHOTOGRAPHER | TALENT"
    text stripe_connect_account_id
    text stripe_connect_status "not_connected|pending|active|restricted"
    text default_country
    text default_city
  }

  ADMIN_USERS {
    uuid user_id PK
    timestamptz granted_at
    uuid granted_by FK
  }

  SUBSCRIPTIONS {
    uuid id PK
    uuid user_id FK
    text stripe_customer_id
    text stripe_subscription_id
    text plan_id "free|amateur|pro"
    text status "active|trialing|past_due|..."
    timestamptz current_period_end
  }

  EVENTS {
    uuid id PK
    uuid user_id FK
    text name
    date date
    text city
    text country
    text activity
    text slug UK
    text share_code UK
    int price_per_photo
    bool is_public
    bool watermark_enabled
    bool is_collaborative
    timestamptz deleted_at "soft delete"
  }

  PHOTOS {
    uuid id PK
    uuid user_id FK
    uuid event_id FK
    text original_url "storage path"
    text photo_hash
    bigint size_bytes
    text upload_status "approved|pending"
    text uploaded_by "owner | invited photographer | guest"
    text delete_token "guest delete"
    timestamptz taken_at
  }

  CARTS {
    uuid id PK
    uuid user_id FK
    timestamptz created_at
  }

  CART_ITEMS {
    uuid id PK
    uuid cart_id FK
    uuid photo_id FK
    uuid photographer_id FK
    int unit_price_cents
  }

  ORDERS {
    uuid id PK
    uuid user_id FK
    uuid cart_id FK "nullable"
    text stripe_payment_intent_id UK
    text stripe_checkout_session_id UK
    text status "pending|completed|failed|refunded|..."
    int total_amount_cents
    text currency
    timestamptz completed_at
  }

  ORDER_ITEMS {
    uuid id PK
    uuid order_id FK
    uuid photo_id FK
    uuid photographer_id FK
    int unit_price_cents
    int total_price_cents
  }

  PAYMENT_ACCOUNTS {
    uuid id PK
    uuid photographer_id FK
    text type "bank_account|paypal|wise|other"
    text country_code
    jsonb account_details
    bool is_default
    bool is_verified
  }

  PAYOUTS {
    uuid id PK
    uuid photographer_id FK
    int amount_cents
    text status "pending|approved|paid|cancelled"
    text stripe_transfer_id
    timestamptz paid_at
  }

  AI_SEARCH_PROFILES {
    uuid id PK
    uuid user_id FK
    text name
    vector selfie_embedding "768-dim"
    text activity_type
    text country
    text region
    date date_from
    date date_to
  }

  PHOTO_EMBEDDINGS {
    uuid photo_id PK
    vector embedding "768-dim, HNSW indexed"
    text model_version
  }
```

**Auxiliary tables not pictured:**

- `talent_photo_tags` — talent users tagged on photos (photographer side for
  in-app tagging; talent side for "my photos" view). Composite-unique on
  `(photo_id, talent_user_id)`.
- `rate_limit_buckets` — fixed-window counter table backing `lib/rate-limit.ts`.
  Composite PK `(bucket_key, window_start)`. Service-role-only access.
- `ai_search_usage` — monthly per-user search counter; unique on
  `(user_id, period_year, period_month)`. Drives subscription-tier rate
  limits.
- `download_tokens` — opaque tokens minted on purchase that let guests
  download their photos via `/[lang]/download/[token]` without auth.
- `guest_orders` / `guest_order_items` / `pending_guest_checkouts` — mirror
  of the authenticated order flow for unauthenticated buyers.
- `event_photographers` — invitations to additional photographers for
  collaborative "organizer" events.
- `time_sync_tokens` — backs the camera-time-sync feature.
- `user_roles` / `user_role_memberships` — set of roles a user may switch
  between (vs `profiles.active_role` which is the *currently selected* role).
- `feedback` — user-submitted product feedback.

**Known schema-level findings** (see `docs/AI_MATCHING_AUDIT.md`):

- `photo_embeddings` INSERT/UPDATE policies are `using (true) with check
  (true)` — same defense-in-depth gap that was closed on `orders`/`payouts`.
  Authenticated users can write arbitrary embeddings via PostgREST.
- `ai_search_usage` has the same permissive UPDATE/INSERT/DELETE policy,
  and its `SECURITY DEFINER` RPCs (`increment_ai_search_usage`,
  `get_ai_search_usage_count`) never had EXECUTE revoked from anon /
  authenticated — they can be called directly by any user via PostgREST.

---

## 4. Key user flows

### 4.1 Photo purchase (authenticated talent)

The cart lives in Postgres for authenticated users. Checkout creates a Stripe
Checkout Session; the order is **only** written to the DB after Stripe
confirms via webhook, so abandoned checkouts produce no order rows. The
`checkout.session.completed` event writes the order and clears the cart; the
subsequent `payment_intent.succeeded` flips the status to `completed` *and*
creates the per-photographer Connect transfers in the same handler.

```mermaid
sequenceDiagram
  participant T as Talent
  participant App as Next.js
  participant SB as Supabase
  participant S as Stripe

  T->>App: addPhotoToCartAction (Server Action)
  App->>SB: insert cart_items (user-scoped)

  T->>App: POST /api/stripe/checkout
  App->>S: stripe.checkout.sessions.create({cart_id, user_id})
  S-->>App: session.url
  App-->>T: redirect to Stripe Checkout

  T->>S: complete payment
  S->>App: webhook: checkout.session.completed
  App->>SB: createOrder(status='completed') + addOrderItems (service role)
  App->>SB: clearCart(cart_id)

  S->>App: webhook: payment_intent.succeeded
  App->>SB: SELECT order_items by order_id
  loop For each (photographer, total_price)
    App->>S: stripe.transfers.create(amount, destination=connect_account, idempotency_key)
    S-->>App: transfer.id
    App->>SB: insert payouts(status='paid', stripe_transfer_id)
  end
```

### 4.2 Photographer onboarding

Google is the only auth provider; a fresh user lands at `/onboarding/role`,
chooses PHOTOGRAPHER, picks a username, and is dropped on the dashboard. The
Stripe Connect Express onboarding is a separate step gated behind
"connect your payout account" — events can be created before this, but
checkout for that photographer's photos is blocked until `account.updated`
flips `stripe_connect_status` to `active`.

```mermaid
sequenceDiagram
  participant U as User
  participant App as Next.js
  participant G as Google OAuth
  participant SB as Supabase
  participant S as Stripe

  U->>App: click "Sign up"
  App->>G: signInWithGoogle (state in httpOnly cookie)
  G-->>App: callback to /auth/callback?code=...
  App->>SB: exchangeCodeForSession
  App-->>U: redirect to /onboarding/role

  U->>App: choose PHOTOGRAPHER + username
  App->>SB: upsert profiles(active_role) + user_roles
  App-->>U: redirect to /dashboard/photographer

  U->>App: open Payout Profile, click "Connect Stripe"
  App->>S: stripe.accounts.create(type='express')
  App->>S: stripe.accountLinks.create
  S-->>App: onboarding URL
  App-->>U: redirect to Stripe-hosted onboarding
  U->>S: complete onboarding
  S->>App: webhook: account.updated
  App->>SB: updateProfile(stripe_connect_status='active')

  U->>App: create first event at /dashboard/photographer/events/new
```

### 4.3 Photographer payout (via Stripe Connect transfer)

**Correction to CLAUDE.md:** there is no weekly payout cron. Transfers fire
**synchronously** with `payment_intent.succeeded` in the Stripe webhook,
one per (order_item, photographer) pair. The `payouts` table is the
historical record. A separate manual workflow exists where photographers
can request payouts and admins approve them via `/api/admin/payouts/[id]`,
but that path is admin-driven, not scheduled.

```mermaid
sequenceDiagram
  participant Buyer
  participant S as Stripe
  participant App as Webhook handler
  participant SB as Supabase

  Buyer->>S: pay via Checkout
  S->>App: webhook: payment_intent.succeeded
  App->>SB: getOrderByPaymentIntentId
  App->>SB: updateOrderStatus(status='completed')

  App->>SB: SELECT photographer_id, total_price_cents FROM order_items WHERE order_id
  loop per photographer in this order
    App->>SB: get photographer.stripe_connect_account_id
    alt status == 'active'
      App->>S: stripe.transfers.create({amount, destination, idempotency_key='transfer_<charge>_<order>'})
      S-->>App: transfer.id
      App->>SB: insert payouts(amount_cents, status='paid', stripe_transfer_id, paid_at=now)
    else not active
      App->>App: log + skip (recoverable via admin endpoint later)
    end
  end
```

### 4.4 Guest cart merge on login

Guest carts live in `localStorage` under `picdemi_guest_cart`. On `SIGNED_IN`,
the client-side `GuestCartMerge` component calls a Server Action that
re-validates each photo against the DB (re-fetching the current price — the
client cannot tamper with prices) and adds it to the user's persistent cart.
Only on success does it clear the localStorage entry.

```mermaid
sequenceDiagram
  participant Browser
  participant Auth as Supabase Auth (client SDK)
  participant App as Server Action
  participant SB as Supabase DB

  Note over Browser: items live in localStorage<br/>(picdemi_guest_cart)
  Browser->>Auth: complete sign-in
  Auth-->>Browser: onAuthStateChange("SIGNED_IN")
  Browser->>App: mergeGuestCartAction(items)
  App->>SB: getOrCreateCart(user.id)
  loop per item
    App->>SB: getPhoto(photo_id) [service role]
    App->>SB: getEvent(event_id) -> current price_per_photo
    App->>SB: addPhotoToCart(cart_id, photo_id, photographer_id, unit_price_cents)
  end
  App-->>Browser: mergedCount
  Browser->>Browser: clearGuestCart() if mergedCount > 0
  Browser->>Browser: invalidateQueries(['cart-data'], ['cart-count'])
```

---

## 5. Photo upload + serving flow

Photographers upload directly to Supabase Storage (private bucket
`photos`). On the way in, `lib/photo-upload.ts:validatePhotoUpload` reads
magic bytes via Sharp and rejects anything that isn't a known image format;
the storage extension and content-type are derived from the *detected*
format, never from `file.name` or `file.type`. The originals are
payment-gated: previews are served watermarked through `/api/watermark`
(service role + tile overlay via Sharp), and full-resolution access only
happens through short-lived signed URLs after a purchase is confirmed.

```mermaid
flowchart LR
  Photog["Photographer"]
  UploadAction["Server Action<br/>validatePhotoUpload<br/>(Sharp magic-byte)"]
  Storage[("Supabase Storage<br/>bucket: photos<br/>private")]
  PhotosTable[("photos row<br/>original_url = storage path")]
  PublicView["Talent / Guest"]
  WMApi["/api/watermark/[...path]<br/>service role download<br/>+ Sharp watermark"]
  Purchase["Purchase confirmed<br/>(Stripe webhook)"]
  Signed["createSignedUrl<br/>1h-24h TTL"]

  Photog --> UploadAction
  UploadAction -->|put| Storage
  UploadAction -->|insert| PhotosTable
  PublicView -->|GET watermarked preview| WMApi
  WMApi -->|service role download| Storage
  Purchase --> Signed
  Signed -->|signed URL| Storage
  PublicView -.->|download full-res| Signed
```

Fail-closed behavior: the watermark API serves a generic placeholder JPEG
on any internal failure rather than falling back to the un-watermarked
source (see `app/api/watermark/[...path]/route.ts`).

---

## 6. AI matching architecture — **PLANNED · DISABLED**

The AI face-recognition feature has database scaffolding (HNSW-indexed
vectors, RPC for similarity search) and a complete UI behind the
`AI_MATCHING` feature flag, but **production traffic is disabled**. The
only embedding provider currently wired is a deterministic mock that does
not produce real similarity. A `feature/ai-matching-rewrite` branch added a
Replicate CLIP provider and a hybrid (perceptual hash + color signature +
embedding) approach but was never merged. See `docs/AI_MATCHING_AUDIT.md`
for a detailed inventory.

```mermaid
flowchart LR
  subgraph WhenEnabled["When AI_MATCHING=true (PLANNED)"]
    direction LR
    NewPhoto["Photo uploaded"]
    Provider["EmbeddingProvider<br/>Mock today / Replicate CLIP planned"]
    Embed[("photo_embeddings<br/>vector(768)<br/>HNSW · cosine_ops")]

    Selfie["Talent selfie<br/>(in AI matching modal)"]
    SearchProfile[("ai_search_profiles<br/>selfie_embedding 768")]

    RPC["search_photos_by_similarity()<br/>SECURITY DEFINER<br/>filters by activity/country/date"]
    Usage[("ai_search_usage<br/>monthly counter")]
    Results["Top-N matches<br/>→ talent_photo_tags"]
  end

  NewPhoto --> Provider
  Provider --> Embed

  Selfie --> Provider
  Provider --> SearchProfile

  SearchProfile --> RPC
  Embed --> RPC
  RPC --> Results
  RPC -.->|increment| Usage
```

Status snapshot:

| Concern | State |
|---|---|
| Feature flag | `AI_MATCHING: false` in `lib/feature-flags.ts` |
| UI | Built (button + 5-step modal + results); renders "Coming soon" |
| DB schema | Deployed (vector(768), HNSW, RPC) — partially ahead of TS code |
| Embedding provider | Mock-only on `main`; Replicate CLIP exists on stale rewrite branch |
| Similarity search | `findSimilarPhotos` in `main` does app-layer cosine over a 1000-row prefetch (does not call the RPC, ignores HNSW); rewrite branch fixes this |
| Server actions | Wired and callable; flag check only enforced in UI |
| Rate limits | Tier quotas defined in `lib/ai/rate-limits.ts` (3 / 20 / unlimited per month) |

---

## 7. Tech stack summary

| Tech | Version | Role |
|---|---|---|
| **Next.js** | 16 | App Router, Server Components, Server Actions, API routes |
| **React** | 19 | UI framework |
| **TypeScript** | 5.9 | Type system (strict, no `any` allowed) |
| **Supabase** | `@supabase/ssr` 0.8, `supabase-js` 2.105 | Postgres + Auth (Google OAuth) + Storage + Realtime |
| **Postgres + pgvector** | 17 / 0.7 | Row-level security on every table; HNSW indexes for AI |
| **Stripe** | 20.4 | Checkout Sessions, Subscriptions, Connect Express transfers |
| **Resend** | 6.x | Transactional emails (purchase receipts, guest order delivery) |
| **Google OAuth** | — | Only auth provider |
| **Google Maps Places** | — | Location autocomplete in event create/edit forms only |
| **Replicate** | — | **PLANNED** CLIP embeddings (`andreasjansson/clip-features`, 768-dim) |
| **Sharp** | 0.34 | Server-side watermarking + magic-byte image validation |
| **Tailwind CSS** | v4 | Styling (CSS-first config in `app/globals.css`) |
| **shadcn/ui** | New York style + Radix primitives | Component library — do not introduce alternatives |
| **TanStack React Query** | 5 | Client-side data fetching/cache (cart count, AI search availability) |
| **TanStack React Form** | 1.x | Form state |
| **Zod** | 4 | Schema validation (forms + env via T3 Env) |
| **T3 Env** | 0.13 | Type-safe env vars in `env.mjs` |
| **Biome** | 2.3 | Linting + formatting (replaces ESLint + Prettier) |
| **tsx** | 4 | Test runner via `node:test` (`pnpm test`) |
| **pnpm** | — | Package manager + workspace lockfile |
| **Vercel** | — | Hosting (no native cron — payouts fire via Stripe webhook, not schedule) |

---

## Cross-references

- `CLAUDE.md` — engineering conventions, security utilities, code style.
- `docs/AI_MATCHING_AUDIT.md` — detailed reusability assessment of the AI
  feature scaffolding.
- `docs/AI_MATCHING.md` and `docs/AI_EMBEDDINGS_SETUP.md` — present only on
  the `feature/ai-matching-rewrite` branch.

**Discrepancies between CLAUDE.md and this document** (this document wins
for "what the code does today"):

1. CLAUDE.md says "Automatic weekly payouts via Stripe Connect ($25 minimum
   threshold)" — the codebase has no cron and no $25 threshold. Transfers
   are per-order, synchronous with `payment_intent.succeeded`.
2. CLAUDE.md says "AI Photo Search ... rate limiting" implies it is live —
   it is disabled.
3. CLAUDE.md lists `database/queries/sales.ts` and `earnings.ts` — those
   live as action files under `app/[lang]/dashboard/photographer/`, not as
   query modules.
