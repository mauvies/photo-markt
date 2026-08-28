# Photo Markt — Architecture

Living architecture reference. Each section pairs a Mermaid diagram with a short
prose intro. Anything not yet implemented is explicitly marked **PLANNED** or
**DISABLED**.

Source of truth: actual migrations in `supabase/migrations/`, query layer in
`src/database/queries/`, routes in `src/app/[lang]/`, feature flags in
`src/lib/feature-flags.ts`. CLAUDE.md is supplementary; where the two ever
disagree, the code (and therefore this document) wins. One detail worth
calling out: payouts fire **per-order on the Stripe webhook**, not on a cron.

---

## 1. System context

Three user types interact with one Next.js app, which fans out to a handful of
external systems. Stripe and Supabase carry the load; the rest are
single-purpose integrations. AWS Rekognition (face indexing/search) and Inngest
(the background-job runner that drives it) are now live — AI photo matching
ships on `main`.

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
  Rekognition["AWS Rekognition<br/>Face collections"]
  Inngest["Inngest<br/>Background jobs"]

  Photographer --> App
  Talent --> App
  Guest --> App

  App --> Supabase
  App --> Stripe
  App --> Resend
  App -->|sign-in| Google
  App -->|location autocomplete| GMaps
  App -->|enqueue jobs| Inngest
  Inngest -->|index / search faces| Rekognition

  Stripe -->|webhooks| App
  Google -->|OAuth callback| App
  Inngest -->|invoke /api/inngest| App
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

  Middleware["src/proxy.ts<br/>Supabase session refresh + i18n locale detect"]

  subgraph AppRouter["Next.js App Router"]
    RSC["React Server Components<br/>page.tsx · layout.tsx"]
    Actions["Server Actions<br/>'use server' files"]
    ApiRoutes["API Routes<br/>src/app/api/* (Stripe webhook, Inngest, watermark)"]
  end

  Queries["src/database/queries/*<br/>Domain query layer (events, photos, carts, ...)"]

  ClientSb["src/database/client.ts<br/>anon JWT · RLS enforced"]
  ServerSb["src/database/server.ts<br/>user JWT · RLS enforced"]
  AdminSb["src/database/supabase-admin.ts<br/>service role · bypasses RLS"]

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
  reserved for things that must be addressable HTTP endpoints (Stripe webhook,
  Inngest worker, watermark CDN-style URL, downloads, health). ⚠️ **There are no
  admin API routes** — the last one was deleted in T-220; an admin-only surface
  is a Server Component page gated on `admin_users`
  (`[lang]/dashboard/admin/status/page.tsx`).
- **Service role is used only when RLS would block a legitimate operation**
  (Stripe webhook writes, the admin-gated page, watermark API, Inngest
  face-index writes). Every other path uses the user-scoped client so RLS
  catches mistakes.

### 2.1 Database code layout — two deliberate layers

Everything database-related lives in **two** places, on purpose. They are not
one thing split by accident — they are two different layers with two different
owners, and merging them into one physical directory fights a hard convention
either way:

| Layer | Location | Owner | What lives here |
|-------|----------|-------|-----------------|
| **Infrastructure** | `supabase/` (repo root) | Supabase CLI | `config.toml`, `migrations/`, `seed.sql`, `.branches`, `.temp`, `snippets/` |
| **Application code** | `src/database/` | The app | `client.ts` / `server.ts` / `supabase-admin.ts` (the three clients) + `queries/` (the domain query layer) |

Why they stay separate:

- **`supabase/` must sit at the repo root.** The Supabase CLI (`supabase
  start/reset/db push`, migration diffing, branching) resolves `supabase/`
  relative to the project root. `--workdir` exists but is off-convention and
  breaks the default `pnpm db:*` scripts. Moving it buys nothing and breaks the
  migration flow.
- **`src/database/` must stay under `src/`.** T-019 (PR #76) moved *all*
  application source under `src/`. Pulling the DB code back out to the root to
  sit next to `supabase/` would re-break that convention.

So the split is intentional: **infra vs app code**, not "misplaced files". Each
directory carries a `README.md` pointing at the other so the two halves are
discoverable from either side. Editors looking for "the database stuff" should
start at whichever layer matches the task — schema/migrations → `supabase/`;
reads/writes from the app → `src/database/queries/`.

---

## 3. Database schema (ER diagram)

The schema separates clearly into three concerns: identity (`profiles`,
`admin_users`, `subscriptions`), commerce (`carts → orders → payouts`), and
AI face matching (`photo_faces`). All `*_id` FKs to "users" are
to Supabase's built-in `auth.users` table (shown collapsed onto `profiles`
since `profiles.id` is a 1:1 FK to it). Auxiliary tables like
`talent_photo_tags`, `rate_limit_buckets`, `download_tokens`, `guest_orders`,
`event_photographers`, `user_roles`, `feedback`, and
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
  PHOTOS ||--o{ PHOTO_FACES : "faces indexed in"

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
    text plan_id "free|starter|pro (legacy 'amateur' = starter; CHECK constraint dropped)"
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
    bool ai_matching_enabled "photographer opt-in"
    bool contains_minors "blocks indexing"
    text rekognition_collection_id "per-event AWS collection"
    text rekognition_region
    text ai_matching_status "idle|indexing|ready|failed"
    timestamptz deleted_at "soft delete"
  }

  PHOTOS {
    uuid id PK
    uuid user_id FK
    uuid event_id FK
    text original_url "storage path"
    bigint size_bytes
    int width
    int height
    text upload_status "approved|pending"
    text uploaded_by "owner | invited photographer | guest"
    text face_index_status "pending|indexing|indexed|failed|no_faces|not_applicable"
    text thumbnail_status "pending|ready|failed"
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
    text activity_type
    text country
    text region
    date date_from
    date date_to
  }

  PHOTO_FACES {
    uuid photo_id FK
    text aws_face_id "returned by Rekognition IndexFaces"
    text aws_collection_id
    numeric confidence
    jsonb bounding_box "{Width,Height,Left,Top}"
    timestamptz indexed_at
  }
```

> The face embeddings themselves live inside AWS Rekognition collections —
> Postgres only stores the returned `aws_face_id` per face. The old
> `photo_embeddings` / `selfie_embedding` pgvector schema was dropped in
> migration `20260518000000_drop_legacy_ai_schema.sql`.

**Auxiliary tables not pictured:**

- `talent_photo_tags` — talent users tagged on photos (photographer side for
  in-app tagging; talent side for "my photos" view). Composite-unique on
  `(photo_id, talent_user_id)`.
- `rate_limit_buckets` — fixed-window counter table backing `src/lib/rate-limit.ts`.
  Composite PK `(bucket_key, window_start)`. Service-role-only access.
- `photo_faces` — one row per face AWS Rekognition indexes in a photo
  (`aws_face_id`, `aws_collection_id`, `confidence`, `bounding_box`). Unique on
  `(photo_id, aws_face_id)`. Talent selfie search maps Rekognition face IDs back
  to photos through this table (`src/database/queries/rekognition.ts`).
- `download_tokens` — opaque tokens minted on purchase that let guests
  download their photos via `/[lang]/download/[token]` without auth.
- `guest_orders` / `guest_order_items` / `pending_guest_checkouts` — mirror
  of the authenticated order flow for unauthenticated buyers.
- `event_photographers` — invitations to additional photographers for
  collaborative "organizer" events.
- `user_roles` / `user_role_memberships` — set of roles a user may switch
  between (vs `profiles.active_role` which is the *currently selected* role).
- `feedback` — user-submitted product feedback.

**Legacy AI schema — gone.** The original pgvector matching path was removed in
two passes. `20260518000000_drop_legacy_ai_schema.sql` dropped
`photo_embeddings`, `ai_search_profiles.selfie_embedding`,
`photos.photo_hash` / `color_signature` and the `search_photos_by_similarity()`
RPC; `20260820000000_prune_dead_schema.sql` (T-219) finished the job, dropping
`ai_search_profiles`, `ai_search_usage`, the orphaned
`set_photo_embeddings_updated_at()` trigger function and the `vector` extension
itself. The same migration removed the other unfinished features'
leftovers — `payment_accounts` (superseded by Stripe Connect),
`time_sync_tokens`, `upload_batches`, `upload_objects`, `profiles.is_admin`
(authorization is `admin_users`) and the ghost `events` columns
`start_date` / `end_date` / `time_offset` / `time_sync_enabled` /
`organizer_fee_per_photo_cents`. Live face matching is AWS Rekognition, which
stores its embeddings in AWS; the DB keeps only the returned `aws_face_id` per
photo in `photo_faces`. `test/unit/database/dead-schema-pruned.test.ts` keeps
any of it from returning.

---

## 4. Key user flows

### 4.1 Photo purchase (authenticated talent)

The cart lives in Postgres for authenticated users. Checkout creates a Stripe
Checkout Session; the order is **only** written to the DB after Stripe
confirms via webhook, so abandoned checkouts produce no order rows. The
`checkout.session.completed` event writes the order and clears the cart; the
subsequent `payment_intent.succeeded` flips the status to `completed`. **Both
events then drive the per-photographer Connect transfers for authenticated
orders** through the shared `drivePayoutsForOrder` (T-252) — Stripe does not
guarantee delivery order, and when only the payment event transferred, a delivery
that arrived first found no order yet and nobody ever paid. Whichever arrives
first pays; the second no-ops on `openPayoutRow`'s unique index rather than
paying twice. A *redelivery* of a session whose order already exists stops
before the drive: that index is partial on `stripe_charge_id is not null`, so
pre-T-216 rows are outside it and re-driving an old session would pay twice.
The guest flow (`checkout.session.completed` only) still has a single driver.

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
  App->>S: paymentIntents.retrieve (latest_charge)
  App->>SB: drivePayoutsForOrder → transfers (T-252)

  S->>App: webhook: payment_intent.succeeded
  Note over App,SB: same drive; openPayoutRow returns null if already paid
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
**synchronously** in the Stripe webhook, one per (order_item, photographer)
pair, from whichever of `checkout.session.completed` / `payment_intent.succeeded`
arrives first (T-252). Since **T-216** there *is* a retry
cron (`retry-pending-payouts`, `10,40 * * * *`), but it only drains money the
synchronous path could not send — a recovery path, not the normal one.
**There is no administrative payout endpoint** (T-220 deleted it). Payout rows
are written by three service-role paths and no other: the webhook's transfer
path, the retry worker, and `voidHoldsForCharge` on `charge.refunded` — the last
being the one that *does* cancel holds, which is why "who can cancel a hold?"
must not be answered from the first two alone.

The endpoint it replaced could set any status on any row, and the reason that
mattered is narrower than "it was unused": **a status change is not a transfer**
— it wrote a column and called no Stripe API, so its one distinctive power was
making the ledger claim a payment that never happened, in a system where the
`payouts` rows are the authority an operator reconciles Stripe against (T-249).
The actions an admin UI would have offered are either already automated
(recoverable holds drain via the retry worker; `charge.refunded` voids them) or
harmful (cancelling a hold by hand makes it permanently unpayable, because
`payouts_charge_photographer_key` then blocks a replacement row).

⚠️ **"Holds drain automatically" is not universal, and the deleted endpoint was
never the answer for the exceptions.** A row stranded `processing` with no
`transfer_batch_id` matches neither recovery selector, and a lone sub-50¢ hold
simply accumulates until more sales join it. Surfacing those is **T-254**. The
endpoint could not have touched either, since it refused every row carrying a
`stripe_charge_id`. Its only reachable targets were pre-T-216 rows with a null
charge id — **of which production currently has none** (T-236 was closed in
August 2026 with nothing to sweep); should one ever appear, it is corrected
through direct DB access, the same tool this project already prescribes for
seeding admins.

⚠️ **Since T-248 the checkout no longer filters on Connect status**, so
`connect_inactive` is the ORDINARY way a hold is born rather than a near-
impossible edge case: a photographer can sell before finishing onboarding and
the ledger holds their net until `account.updated` reports the account active.
That reclassifies the retry worker too — for this reason it is the *completion*
of a normal sale, not only a recovery path. The checkouts previously returned
`photographer_not_connected`; that code was deleted rather than left unused, so
the refusal cannot be reinstated by accident.

**The payout row is created BEFORE the Stripe call, and its id IS the
idempotency key** (`payout_<row.id>`), used identically by the webhook and the
retry worker. That ordering is what makes the
`(stripe_charge_id, photographer_id)` unique index *prevent* a second payment
rather than merely record that one happened. Before T-216 the row was written
afterwards and the two writers had separate idempotency namespaces, so a
redelivery past Stripe's 24-hour window paid twice — and the swallowed `23505`
on the log insert erased the evidence.

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
    App->>App: netCents = getPhotographerNetCents(gross, plan)
    App->>SB: openPayoutRow(charge, photographer, net, currency)
    alt unique violation
      App->>App: another writer owns this money - transfer NOTHING
    else active and net >= 50c
      App->>S: transfers.create(amount, destination, source_transaction=charge, idempotency_key=payout_ROWID)
      S-->>App: transfer.id
      App->>SB: settlePayoutPaid(row.id, transfer.id)
    else held
      App->>SB: row stays pending + hold_reason (connect_inactive / below_minimum / transfer_failed)
    end
  end
```

**Recovery — `retry-pending-payouts`** (`src/lib/inngest/functions/`): ONE
Inngest function with two triggers (cron `10,40` plus `payouts.retry-requested`,
emitted by `account.updated` on activation) and `concurrency: {limit: 1}`.
⚠️ One function, not two registrations — Inngest scopes concurrency per function
id, so splitting them would allow concurrent runs for the same photographer.

```mermaid
flowchart TD
  A["holds: pending + hold_reason + stripe_charge_id"] --> B{"Connect active? (live reconcile)"}
  B -- no --> A
  B -- yes --> C{"amount >= 50c?"}
  C -- yes --> D["individual transfer<br/>source_transaction = charge<br/>key = payout_ROWID"]
  C -- no --> E["group by (photographer, currency)"]
  E --> F{"group >= 50c?"}
  F -- no --> A
  F -- yes --> G["claim rows: processing + batch id"]
  G --> H{"claimed total still >= 50c?"}
  H -- no --> I["release to pending<br/>(no Stripe call was made)"]
  H -- yes --> J["source-less transfer<br/>key = transfer_group = payout_batch_ID"]
  D --> K["settle: paid"]
  J --> K
```

A batch left `processing` past 30 minutes is re-driven under the **same** batch
id. Because an idempotency key only dedupes for 24 hours, the re-drive first
probes `transfers.list({transfer_group})`, cross-checking destination *and*
amount; a failed probe is **unknown → do not transfer**, never "none found".

⚠️ **A shared idempotency key is worthless unless the parameters match too.**
Stripe compares the *entire request body* against the one first stored under a
key and 400s on any divergence, so both writers must build byte-identical
`createTransfer` arguments for a row — which is why `transfer_group` is derived
from the **payout id** (`payoutTransferGroup`) and not from the order id. Getting
this wrong wedges every `transfer_failed` retry for the key's whole 24-hour life,
logged indistinguishably from a Stripe outage, and then issues a real second
transfer once the key expires. Pinned from both sides by
`test/unit/lib/payout-batching.test.ts` and the two integration suites.

Two independent guards stop a double payment, so neither has to be perfect: the
shared idempotency key (24h), and `source_transaction`, which Stripe refuses to
over-draw — and that one never expires. A `transfer_failed` hold gets a third:
it is the only hold reason created *after* a Stripe call, so the worker probes
`findTransferByGroup` before re-driving it. It is dropped only for the aggregated
batch, which spans several charges and so cannot carry it; that path exists
solely because a sub-50-cent net can never clear Stripe's floor alone, which
keeps its amounts tiny by construction.

**Refunds:** `charge.refunded` now voids any *outstanding* hold for that charge,
so unsent money is never sent. A transfer already made still needs a manual
reversal — T-215 owns automating that.

**Connect API version — Accounts v1 (deliberate, T-164).** Our entire Connect
surface uses **Accounts v1**: `accounts.retrieve/create`, `accountLinks.create`,
`balance.retrieve` (`src/lib/stripe/connect.ts`) and the webhook's
`transfers.create`. Since the SDK bump to `stripe@22` (T-152), each v1 Accounts
call relays a server-sent notice — "We recommend building your integration using
Accounts v2" — via `process.emitWarning`. We stay on v1 **on purpose**: it is
fully supported with no sunset date, and migrating to Accounts v2 is a large,
payment-critical change (different account-creation/onboarding/retrieve/balance/
transfer shapes) with no functional benefit today. It would be its own ticket
with OpenSpec + a `/code-review high` pass plus the money-path verifier
fan-out (see `.claude/commands/work-next.md` step 6), not done ad hoc. The recommendation is
informational, so `src/lib/stripe/suppress-accounts-v2-warning.ts` filters that
one message out of process warnings (installed from `config.ts`); every other
warning still surfaces.

### 4.4 Guest cart merge on login

Guest carts live in `localStorage` under `photo-markt_guest_cart`. On `SIGNED_IN`,
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

  Note over Browser: items live in localStorage<br/>(photo-markt_guest_cart)
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
`photos`). On the way in, `src/lib/photo-upload.ts:validatePhotoUpload` reads
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
source (see `src/app/api/watermark/[...path]/route.ts`).

---

## 6. AI matching architecture — **ENABLED**

AI photo matching ships on `main` (`AI_MATCHING: true`). It is built on **AWS
Rekognition face collections** driven by **Inngest** background jobs — the
earlier pgvector/CLIP design was removed (see migration
`20260518000000_drop_legacy_ai_schema.sql`). The face embeddings live inside
AWS; Postgres only stores the `aws_face_id` each photo maps to. Selfies used
for search are **ephemeral** — sent to Rekognition per request and never
persisted.

Two things gate indexing per event: the photographer must opt in
(`events.ai_matching_enabled`) and the event must not be flagged
`contains_minors`. Each event gets its own Rekognition collection, named
`${REKOGNITION_COLLECTION_PREFIX}-${env}-event-${eventId}`
(`src/lib/aws/collection-naming.ts`).

**Indexing (photographer side).** A new photo emits a `photo.uploaded` Inngest
event, which two functions consume in parallel:

```mermaid
flowchart TB
  Upload["Photo uploaded<br/>(server action)"] -->|emit photo.uploaded| Inngest["Inngest"]

  Inngest --> Index["indexPhotoFaces<br/>src/lib/inngest/functions/index-photo-faces.ts"]
  Inngest --> Thumbs["generatePhotoThumbnails<br/>WebP 400px + 800px → Storage"]

  Index -->|download original| Storage[("Supabase Storage")]
  Index -->|IndexFaces (MaxFaces 10, QualityFilter AUTO)| Rek["AWS Rekognition<br/>per-event collection"]
  Index -->|insert rows| Faces[("photo_faces<br/>aws_face_id + bounding_box")]
  Index -->|set face_index_status| Photos[("photos")]
  Index -->|drain → ai_matching_status='ready'| Events[("events")]
```

Lifecycle events fan out to dedicated functions: enabling AI on an existing
event triggers `backfillEventIndexing` (`event.ai-matching-enabled` → create
collection, reset statuses, re-emit `photo.uploaded` per photo); disabling
triggers `disableEventIndexing` (delete collection + `photo_faces`); deleting an
event triggers `cleanupOnEventDelete` (hard-delete the AWS collection even
though the event is soft-deleted, to save cost). All functions are registered at
`src/app/api/inngest/route.ts`.

**Search (talent side).** `searchFacesInEvent`
(`src/app/[lang]/events/[shareCode]/actions.ts`, surfaced by
`src/components/event-gallery-with-face-search.tsx` → `FaceSearchModal`):

```mermaid
sequenceDiagram
  participant T as Talent
  participant App as searchFacesInEvent
  participant Rek as AWS Rekognition
  participant SB as Supabase

  T->>App: submit selfie (in modal)
  App->>App: re-check AI_MATCHING + event eligible (not minors, collection exists)
  App->>App: rate-limit per (shareCode, IP) — 10/hour
  App->>App: validate + downscale selfie (Sharp magic-byte, <5MB)
  App->>Rek: SearchFacesByImage (FaceMatchThreshold 80, MaxFaces 100)
  Rek-->>App: matched aws_face_ids + similarity
  App->>SB: getPhotoFacesByAwsFaceIds → map to photo_ids
  App->>App: dedupe by photo (max similarity), filter to public/approved/non-minor
  App-->>T: matches bucketed: very-likely 95+ · likely 85+ · possibly 80+
```

Every AWS / Sharp / Storage call in both flows is wrapped in `safeCall`
(`src/lib/safe-call.ts`), which strips the original error so image buffers can't
leak into Inngest's step-output record or a serverless error response.

Status snapshot:

| Concern | State |
|---|---|
| Feature flag | `AI_MATCHING: true` in `src/lib/feature-flags.ts` (re-checked server-side in `searchFacesInEvent`) |
| Provider | AWS Rekognition collections — `IndexFaces` / `SearchFacesByImage` / `CreateCollection` / `DeleteFaces` / `DeleteCollection` (`src/lib/aws/`) |
| Background runner | Inngest — `indexPhotoFaces`, `generatePhotoThumbnails`, `backfillEventIndexing`, `disableEventIndexing`, `cleanupOnEventDelete` + storage-cleanup jobs |
| DB footprint | `photo_faces` (face IDs), `events.rekognition_*` / `ai_matching_status`, `photos.face_index_status` / `thumbnail_status` |
| Selfie storage | None — ephemeral per search |
| Rate limits | Monthly quota by plan (free 3 / starter 20 / pro unlimited, `src/lib/ai/rate-limits.ts`) + per-`(shareCode, IP)` 10/hour |
| Compliance gate | `events.contains_minors` blocks indexing and search |

---

## 7. Tech stack summary

| Tech | Version | Role |
|---|---|---|
| **Next.js** | 16 | App Router, Server Components, Server Actions, API routes |
| **React** | 19 | UI framework |
| **TypeScript** | 5.9 | Type system (strict, no `any` allowed) |
| **Supabase** | `@supabase/ssr` 0.8, `supabase-js` 2.105 | Postgres + Auth (Google OAuth) + Storage + Realtime |
| **Postgres** | 17 | Row-level security on every table (pgvector left enabled but unused since the legacy AI schema was dropped) |
| **Stripe** | 20.4 | Checkout Sessions, Subscriptions, Connect Express transfers |
| **Resend** | 6.x | Transactional emails (purchase receipts, guest order delivery) |
| **Google OAuth** | — | Only auth provider |
| **Google Maps Places** | — | Location autocomplete in event create/edit forms only |
| **AWS Rekognition** | `@aws-sdk/client-rekognition` | Face indexing/search for AI photo matching (per-event collections) |
| **Inngest** | — | Background-job runner (face indexing, thumbnails, storage cleanup) served at `/api/inngest` |
| **Sharp** | 0.34 | Server-side watermarking, thumbnail generation + magic-byte image validation |
| **Tailwind CSS** | v4 | Styling (CSS-first config in `src/app/globals.css`) |
| **shadcn/ui** | New York style + Radix primitives | Component library — do not introduce alternatives |
| **TanStack React Query** | 5 | Client-side data fetching/cache (cart count, AI search availability) |
| **TanStack React Form** | 1.x | Form state |
| **Zod** | 4 | Schema validation (forms + env via T3 Env) |
| **T3 Env** | 0.13 | Type-safe env vars in `env.mjs` |
| **Biome** | 2.3 | Linting + formatting (replaces ESLint + Prettier) |
| **Vitest** | — | Test runner (`pnpm test`); integration tests run against local Supabase |
| **pnpm** | — | Package manager + workspace lockfile |
| **Vercel** | — | Hosting (no native cron — payouts fire via Stripe webhook, not schedule) |

---

## Cross-references

- `CLAUDE.md` — engineering conventions, security utilities, code style.
- `docs/deployment.md` — production go-live checklist: env vars, migrations,
  Stripe live-mode, Resend domain, security headers/CSP, post-deploy smoke test.
- `docs/AI_MATCHING_AUDIT.md` — detailed reusability assessment of the AI
  feature scaffolding.
- `docs/AI_MATCHING.md` and `docs/AI_EMBEDDINGS_SETUP.md` — present only on
  the `feature/ai-matching-rewrite` branch.

**Consistency with CLAUDE.md.** As of this revision the two documents agree on
the previously-flagged points: payouts are per-order on the Stripe webhook (no
cron, no minimum threshold), and AI photo matching is **enabled** (AWS
Rekognition + Inngest). If they ever drift again, the code — and this
document — wins for "what runs today."
