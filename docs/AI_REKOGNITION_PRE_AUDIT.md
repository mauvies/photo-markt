# AI Face Recognition (AWS Rekognition) — Pre-implementation audit

**Audit date:** 2026-05-18
**Working branch:** `main`
**Scope:** Codebase areas the AWS Rekognition rebuild will touch. Pairs with `docs/AI_MATCHING_AUDIT.md` (the post-mortem of the abandoned CLIP/Replicate attempt). **No code changes proposed here** — only observations grounded in current code, with recommended approaches drawn from existing patterns.

The Rekognition rebuild target: one face Collection per event, talent selfie sent to `SearchFacesByImage` but not stored, face IDs per-photo persisted in our DB.

---

## 1. Photo upload pipeline

### What exists today

- **Entry point:** `app/[lang]/dashboard/photographer/events/[id]/organizer-upload-section.tsx:1-65` renders a file input accepting `.jpg,.jpeg,.png,.heic`. Submits `FormData` (event_id + file array) to the server action `uploadOrganizerEventPhotoAction`.
- **Server action:** `app/[lang]/dashboard/photographer/events/[id]/actions.ts:185-256` — runs a per-file `for` loop (synchronous, batch in one action invocation). For each file:
  1. `validatePhotoUpload(file)` from `lib/photo-upload.ts:41-65` — Sharp magic-byte check, 50 MB cap, returns `{ buffer, contentType, extension }` (never trusts `file.type`/`file.name`).
  2. `uploadFile(supabase, 'photos', path, validated.buffer, …)` writes to Supabase Storage under `${user.id}/${eventId}/${uuid}.${extension}` (line 229).
  3. `createPhoto(supabase, user.id, { event_id, original_url, upload_status })` inserts a row into `photos` (line 234). `upload_status` is `'approved'` or `'pending'` based on `event.require_upload_approval`.
- **Post-upload hooks:** `revalidatePath()` + `revalidateTag()` at lines 252-254 — Next.js ISR cache invalidation only. **No background jobs, no message queue, no webhooks, no thumbnail/EXIF processing.** The watermarking is **lazy** (computed on read in `/api/watermark/`), not eager at upload.
- **Auth & ownership** are checked at the top of the action (lines 209-215) via `getEvent(supabase, eventId, user.id)`, which enforces ownership via `.eq('user_id', userId)` in the query layer.

### Implications for the AI feature

The natural `photo.uploaded` emission point is **immediately after `createPhoto()` succeeds**, before `revalidatePath()` (line ~244-250 in the existing action). The Buffer from `validatePhotoUpload` is still in scope at that point — it would be cheap to forward to Rekognition `IndexFaces` directly without re-downloading from Storage.

Three viable processing models:
1. **Inline sync** — call `IndexFaces` inside the upload loop. Adds ~300-1500 ms per photo. Risks: Vercel function timeout on bulk uploads (50 photos × 1 s = 50 s, close to the Hobby 60 s cap), no retry on transient AWS errors.
2. **Background queue** — emit a `photo.uploaded` event after the DB insert, process in Inngest/QStash/Trigger.dev. Requires introducing a queue (greenfield — see Section 5). Best fit for the "ship to production" path.
3. **Hybrid** — write the DB row immediately, mark `face_index_status = 'pending'`, fire-and-forget the index call (use Next.js `after()` or `waitUntil`). Cheap and serverless-friendly but no native retry.

### Recommended approach

Hook point is line ~244 of `app/[lang]/dashboard/photographer/events/[id]/actions.ts`. Pass `{ eventId, photoId, storagePath }` to the queue; the worker re-downloads via service-role `supabase.storage.from('photos').download(path)` (Section 4). Use Inngest for retries + observability (Section 5).

### Open questions

- Should AI matching be per-photo opt-in (e.g., photographer marks "no face" on a landscape) or strictly per-event?
- Does re-uploading the same photo need to be idempotent at the Rekognition layer (it's not idempotent today at the storage layer — UUID-suffixed filename)?

---

## 2. Event creation / edit forms

### What exists today

- **Create wizard:** `app/[lang]/dashboard/photographer/events/new/` — multi-step wizard, Zod schema at `wizard.schema.ts:20-47`. Fields: `name, activity, date, country, state, city, event_type ('solo'|'collaborative'|'organizer'), is_public, watermark_enabled, allow_guest_upload, require_upload_approval, price_per_photo, organizer_fee_per_photo`.
- **Step 1 — Configuration** (`steps/step-1-config.tsx`):
  - Event-type radio cards (lines 22-54)
  - Visibility toggle (lines 60-86)
  - Watermark toggle (lines 89-111)
  - Guest-upload toggle, collaborative only (lines 113-132)
  - Upload-approval toggle, collaborative + organizer (lines 133-173)
- **Edit form:** `app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-schema.ts:4-31` is a strict subset of create (no `event_type`, no organizer fee). Edits `name, activity, date, city, is_public, watermark_enabled, allow_guest_upload, require_upload_approval, price_per_photo`.
- **Wire-up:** TanStack React Form + Zod, validated server-side in the matching server action.

### Implications for the AI feature

Two new event-level fields are natural additions:
- `ai_matching_enabled: boolean` (default false on Free plan, default true on paid plans — see Section 11)
- `contains_minors: boolean` (default false; when true, suppress AI matching regardless of `ai_matching_enabled` for compliance)

**Insertion point:** Step 1 Config, after the upload-approval block (line ~173). Same visual pattern as the existing boolean toggles. Both fields should also appear in the **edit** schema — disabling AI on an event mid-flight is a likely user need.

### Recommended approach

1. Add both booleans to the events table via a new migration (Section 7 pattern).
2. Extend `wizard.schema.ts` and `edit-event-schema.ts` with the two fields.
3. Append two `<Switch>` cards after the upload-approval block in `step-1-config.tsx` and in the edit form's equivalent section.
4. When `contains_minors === true`, the server action should ignore `ai_matching_enabled` and ensure no faces get indexed — defense in depth, since the UI should already hide/disable the AI toggle in that branch.

### Open questions

- Is `contains_minors` immutable after creation, or freely editable? (Toggling from true→false retroactively allowing indexing on a kids' event is risky.)
- When `ai_matching_enabled` flips from true→false on an existing event, do we delete the Rekognition collection + face IDs, or just stop accepting search?
- Does "contains minors" need a confirmation modal/disclaimer string (GDPR/COPPA copy)?

---

## 3. Photographer dashboard event detail page

### What exists today

`app/[lang]/dashboard/photographer/events/[id]/page.tsx` layout, top→bottom:

1. **Header bar** (line ~196): `DashboardHeader` with event name on the left; `EventActionsMenu` on the right (line 199).
2. **Metadata strip** (line ~202): single line, `text-sm text-muted-foreground`. Shows formatted date, location, and `price_per_photo` if set.
3. **Share-code box** (line ~213, conditional): `EventShareCode` for collaborative events.
4. **Photographers section** (line ~223, organizer events only): `PhotographersSection` with the membership list.
5. **Tabs container** (line ~231, conditional on `require_upload_approval`): "All Photos" + "Pending {n}" tabs, or a single approved-photos grid (line ~260). Photos render in `EventPhotoAlbum`; pending state via `PendingPhotosTab` (lines 247-256).

### Implications for the AI feature

Three viable surfaces for an "AI indexing status" indicator:

| Candidate | Best for | Tradeoff |
|---|---|---|
| **A. Banner above DashboardHeader** | Alert states ("Indexing failed — retry", "Indexing 42/89") | High visibility but visually heavy when status is healthy |
| **B. Inline chip in metadata strip (line 202)** | Steady-state summary ("AI: 89/89 indexed" or "AI: off") | Lightweight, lives next to existing metadata, but easy to miss |
| **C. Compact metric card between share-code and tabs** | Detailed stats: indexed count, last scan, match count, "Re-index" button | Dedicated space, but more layout work |

### Recommended approach

Combine **B + C**: a small chip in the metadata strip for always-visible status, plus a collapsible metric card (rendered only when `event.ai_matching_enabled === true`) sitting just above the tabs container. Mirrors the existing pattern of "always-on metadata strip" + "conditional feature sections" (photographers / pending-tab) and keeps the page calm when AI is off.

### Open questions

- Real-time progress (poll or WebSocket) vs. stale-on-refresh? Indexing happens out-of-band, so progress updates won't appear without polling.
- Does failure show a retry button per-photo or per-event?

---

## 4. Photo serving / signed-URL flow

### What exists today

- **Watermark API** — `app/api/watermark/[...path]/route.ts`:
  - Resolves storage path → service-role download: `supabase.storage.from('photos').download(fullPath)` (line 95-97).
  - Blob → ArrayBuffer → Buffer (lines 110-111).
  - Pipes through `lib/watermark.ts:47-70` (Sharp resize to 1200 px, composite watermark tile from `public/watermark/`, grayscale noise ~3 % opacity, JPEG q=70).
  - **Fail-closed**: any error returns a placeholder error image, never the original (lines 115-125).
- **Storage helpers** — `database/queries/storage.ts`:
  - `createSignedUrl(supabase, bucket, path, expiresIn?)` — 1 h default TTL (lines 11-24).
  - `createPhotoUrls(supabase, photos, { useWatermark })` — returns `/api/watermark/{path}` URLs when watermarked, otherwise direct signed URLs (lines 112-143).
  - `uploadFile(supabase, bucket, path, body, opts)` — accepts Buffer/ArrayBuffer/Blob, optional upsert (lines 69-87).
- **Service-role client** — `database/supabase-admin.ts:4-7` exports `supabaseAdmin` initialized with `SUPABASE_SERVICE_ROLE_KEY`.

### Implications for the AI feature

For Rekognition `IndexFaces`, two options to deliver bytes:
1. **`Bytes` field** (≤ 5 MB): pass the Buffer directly. Cleanest — no signed URL, no temp S3 write. Matches the watermark-route pattern. Photos may exceed 5 MB though, so we'd need to downscale via Sharp first (the watermark route already does this for previews).
2. **`S3Object` field**: requires the bytes to live in an S3 bucket Rekognition can read. Since we store in Supabase Storage, this means an extra copy → not worth the complexity unless we hit the 5 MB ceiling consistently.

Recommended bytes path:
```
supabase.storage.from('photos').download(path)
  → arrayBuffer → Buffer
  → sharp(buffer).rotate().resize({ width: 1920, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  → Rekognition.IndexFaces({ CollectionId, Image: { Bytes } })
```
Resize ensures we stay under 5 MB and removes EXIF orientation surprises (same call sequence already used in `lib/watermark.ts`).

### Open questions

- Run `IndexFaces` against the **original** or against a **watermark-free downscaled** copy? Original gives best accuracy; downscaled saves bandwidth/cost. Rekognition tolerates ~80×80 px faces, so downscaling to 1920 wide is safe.
- For the talent `SearchFacesByImage` selfie path — the audit notes the existing selfie upload (`ai-matching-modal.tsx:111-120`) trusts client MIME. The new flow MUST route through `validatePhotoUpload` before sending bytes to AWS.

---

## 5. Deployment target & background processing

### What exists today

- **Vercel** is the deployment target (confirmed in `memory/project_deployment.md` and by `NEXT_PUBLIC_VERCEL_URL` use in `env.mjs`). No `vercel.json` checked in — defaults apply.
- Per memory note: repo is **GitHub Free + private**, on Vercel (plan tier unspecified). Hobby = 60 s function timeout; Pro = 300 s.
- **Async patterns in code today:**
  - **Stripe webhook only** (`app/api/stripe/webhook/route.ts`, lines 135-678): all work inline — order creation, transfers, email via Resend (lines 280-289), Stripe API roundtrips (line 295). No queue, no retry.
  - **Next ISR primitives** (`revalidatePath`, `revalidateTag`) — cache, not background work.
  - **No** `waitUntil` / `after()` / cron / Inngest / QStash / Trigger.dev / Supabase Edge Functions in use.
  - **Rate limiting** is Postgres-backed via `lib/rate-limit.ts` (atomic RPC `increment_rate_limit_bucket`) — see Section 9.

### Implications for the AI feature

- A single Rekognition `IndexFaces` round-trip is fast (~300-1500 ms) and would fit inside a server action even on Hobby, but **bulk uploads** (50+ photos in one wizard submit) plus retry would not. Sync-inline is fragile.
- Talent search (`SearchFacesByImage`) is a single call against one collection — sync-inline is fine.
- Introducing a queue is a **greenfield decision** for this codebase. Inngest is the safest match for Next.js + Vercel (native serverless integration, retries, replay, dashboards). Trigger.dev v3 is a viable alternative. QStash is lighter but lacks the observability.

### Recommended approach

- **Talent search path:** synchronous in a server action — no queue needed.
- **Indexing path:** Inngest. Define a `photo/uploaded` event, a function that re-downloads + downscales + indexes, with retry and exponential backoff. Reads of `face_index_status` on `photos` row let the UI poll for progress.
- **Alternative (lighter):** Next.js `after()` for fire-and-forget indexing. No retries, no observability, but zero new infra. Acceptable for v0; replace with Inngest once we know the failure rate.

### Open questions

- Vercel plan tier — Hobby (60 s) or Pro (300 s)?
- Cost ceiling on Inngest free tier (50 k function runs/month) — sufficient for current scale?
- Should indexing be triggerable manually by the photographer (a "Re-index event" button), and if so, does that path also go through the queue?

---

## 6. Environment & secrets management

### What exists today

- `env.mjs` uses `@t3-oss/env-nextjs` + Zod. Three buckets:
  - **`server`** (lines 10-22): `NODE_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`, `STRIPE_PRICE_AMATEUR`, `STRIPE_PRICE_PRO`, `RESEND_API_KEY`.
  - **`client`** (lines 28-35, must use `NEXT_PUBLIC_` prefix): `NEXT_PUBLIC_VERCEL_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`.
  - **`runtimeEnv`** (lines 42-57): map from `process.env`.
- No region-specific config today (no `AWS_REGION`, no multi-region branching).
- Pattern to add a var: declare schema in `server` or `client`, add to `runtimeEnv`. TS enforces presence at build time.

### Implications for the AI feature

New required server-side env vars:
- `AWS_REGION` (e.g., `us-east-1`)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- (optional) `REKOGNITION_COLLECTION_PREFIX` — to namespace collections per env (`photomarkt-prod-event-{eventId}` vs `photomarkt-staging-event-{eventId}`)
- (if Inngest): `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`

### Recommended approach

- Add all to the `server` block in `env.mjs` with `.min(1)` validation. Add to `runtimeEnv` map.
- Use `aws-sdk/client-rekognition` (v3, modular, tree-shakeable) rather than v2.
- Store the per-event collection ID alongside the event row (`events.rekognition_collection_id text`) so we never need to derive it by string-mangling.

### Open questions

- Single AWS region for the collections, or region matched to event location? (Single region is simpler and Rekognition cross-region cost is negligible for our scale.)
- IAM scope — create a dedicated IAM user with `rekognition:*` on a specific collection prefix only.

---

## 7. Database query & migration patterns

### What exists today

**Recent migrations** (newest first):
1. `supabase/migrations/20260514120000_local_reset_compat_recreate_guest_checkout_tables.sql` — `if not exists` guards for guest-checkout tables; RLS enabled with **no inline policies** (lines 80-85), service-role-only access documented in a comment.
2. `supabase/migrations/20260514000001_revoke_rate_limit_rpc_from_public_roles.sql` — explicit `revoke execute … from anon, authenticated` on `increment_rate_limit_bucket` (lines 11-12). This is the security-hardening pattern called out in CLAUDE.md.
3. `supabase/migrations/20260514000000_create_rate_limit_buckets.sql` — table + SECURITY DEFINER RPC + explicit grant only to `service_role` and `postgres` (lines 44-46). RLS on, no policies (service-role-only). Comments explain the security rationale.

**Naming convention:** `YYYYMMDDHHmmss_<verb>_<noun>.sql`. Inline RLS in the same migration that creates the table. Grants/revokes explicit in the same migration (or a follow-up if a security gap is discovered post-deploy).

**Query layer** (`database/queries/*`):
- **Typed returns:** hand-rolled interfaces at the top of each file (e.g., `events.ts:8-29`, `photos.ts:8-44`, `orders.ts:17-46`). No reliance on a generated `database.types.ts`.
- **Error handling:** `.throwOnError()` + post-check `if (error) throw new Error(...)`. Throws, not return tuples.
- **Service-role vs anon:** explicit in the signature and documented. `photos.ts:105-110` is the canonical comment: *"Pass `skipUserIdFilter: true` when the caller has already verified event ownership AND is using the service-role client (so RLS doesn't apply)."*
- **RPC-first with fallback** when the RPC may be absent (e.g., `ai-search-usage.ts:47-108`).

### Implications for the AI feature

New schema we'll likely add (illustrative, not exhaustive):
- `events.ai_matching_enabled boolean`, `events.contains_minors boolean`, `events.rekognition_collection_id text` (Section 6).
- `photo_faces` — one row per detected face: `photo_id, face_id (Rekognition external ID), bounding_box, confidence, indexed_at`.
- `event_ai_settings` (if richer per-event config needed beyond two booleans).
- `rekognition_usage` — monthly counter, mirrors `ai_search_usage` exactly.

### Recommended approach

1. **One migration per logical change.** Table + RLS + policies + grants/revokes in the same file. Use the `20260514000000_create_rate_limit_buckets.sql` migration as the template for SECURITY DEFINER RPCs (explicit grant to `service_role`, explicit revoke from `anon, authenticated`).
2. **`face_id` index:** btree on `photo_faces.face_id` and on `photo_faces.photo_id`. Confidence-filtered queries are point lookups by Rekognition face ID after `SearchFacesByImage` returns.
3. **Query files:** new `database/queries/rekognition.ts` with hand-rolled types, `throwOnError()`, and inline docstrings flagging service-role usage (since Rekognition state is written from the worker, not from user-scoped clients).
4. **RLS:** photographer can read their event's `photo_faces`; talent can read only rows linked to photos they've purchased. Writes service-role only (no `using (true)` permissive policies — same lesson as the orders/payouts hardening called out in `AI_MATCHING_AUDIT.md`).

### Open questions

- Reuse existing `photo_embeddings` table (currently dead but indexed) for `face_id` or start clean? Clean is safer — that table's columns + RLS were designed for vector embeddings, not face IDs.
- Drop the broken second overload of `search_photos_by_similarity` (audit §2) in this work, or in a separate cleanup migration?

---

## 8. Role & permission patterns

### What exists today

- **Photographer role check:** no shared `requirePhotographer` helper. Server actions inline-call `getActiveRole()` from `app/[lang]/actions/roles.ts` (lines 121-147), which reads `profiles.active_role` via the `getProfileActiveRole` RPC.
- **Event ownership:** enforced **at the query layer**, not in a wrapper. `events.ts:106-125` (`getEvent`) and `eventExists(supabase, eventId, userId)` both filter `.eq('user_id', userId)`. The action calls the query, checks for null, throws.
- **Admin check:** repeated inline. Each admin endpoint imports `supabaseAdmin`, queries `admin_users` for the user_id, returns 403 if missing (`app/api/admin/payouts/[id]/route.ts:40-50`). `admin_users` has RLS on with **no policies** (`supabase/migrations/20260513000000_move_is_admin_to_admin_users.sql:22`).

### Implications for the AI feature

Server actions that mutate face-indexing state need to verify:
1. The user is authenticated and has `active_role === 'photographer'`.
2. The user owns the event (`eventExists(supabase, eventId, userId)`).
3. (For talent search) the user is authenticated as talent — `active_role === 'talent'`. Public unauthenticated search is out of scope per the design (selfie not stored, but searcher is identified).

### Recommended approach

- **Don't introduce a `requirePhotographer` helper for one feature.** Follow the existing inline pattern: `getActiveRole()` + `eventExists()`. Consistency wins over slight DRY gains.
- **Do** consider adding `lib/auth/require-admin.ts` *if* the AI feature adds admin endpoints (e.g., admin override of a photographer's quota). The `admin_users` lookup is now repeated in several routes — one helper would clean that up. But this isn't required to ship AI matching.
- **Rate-limit calls** (Section 9) can be applied at the start of the server action, just after the auth/ownership checks. See `app/api/admin/payouts/[id]/route.ts:28-37` for the canonical call shape.

### Open questions

- Should event-level "AI matching enabled" be togglable by a collaborator/co-photographer on an organizer event, or only by the event owner? (Current ownership pattern is single-owner via `user_id`.)

---

## 9. Rate limiting

### What exists today

Two parallel mechanisms — neither subsumes the other:

- **`lib/rate-limit.ts`** — general-purpose Postgres fixed-window limiter. API: `rateLimit({ key, limit, windowSec }, backend?)`. Helpers: `computeWindow`, `evaluate`, `getClientIp`, `retryAfterSeconds`. **Fails open** on backend error (line 84 — "we'd rather serve a request than 500 the whole app"). Backend pluggable via `RateLimitBackend` type; current backend is the Postgres RPC `increment_rate_limit_bucket`.
  - Call sites: `app/api/admin/payouts/[id]/route.ts:28-37` (30/min per admin), `app/api/stripe/checkout/route.ts` (20/hour per user).
- **`database/queries/ai-search-usage.ts`** — purpose-built monthly counter for AI search. Two SECURITY DEFINER RPCs (`increment_ai_search_usage`, `get_ai_search_usage_count`). Persists per `(user_id, period_year, period_month)`. User-readable; system policy allows internal writes.

### Implications for the AI feature

Two limit shapes we'll need:
1. **Monthly quota per plan tier** — "how many faces per month can a photographer index", "how many talent searches per month". Long window, persistent counter, user-visible in dashboard. → `ai-search-usage.ts` shape.
2. **Burst rate-limit** — "no more than N index requests per minute per user, per IP for guest selfie searches". Short window, anti-abuse, no UI surface. → `lib/rate-limit.ts`.

These stack: quota check throws an upgrade-prompted error; burst check returns 429 with `Retry-After`.

### Recommended approach

- Create `rekognition_usage` table with a `(user_id, period_year, period_month, index_count, search_count)` shape (or split index vs search into separate tables — easier for analytics). Mirror `ai_search_usage` migration verbatim including the SECURITY DEFINER + explicit grant/revoke pattern.
- For burst-protect endpoints, use `rateLimit({ key: 'rekognition-index:${userId}:${eventId}', limit: 60, windowSec: 60 })` (same shape as the admin-payouts example).
- For unauthenticated talent search (if we ever support guest selfie search): key by IP via `getClientIp(headers)`.

### Open questions

- Are there per-event hard caps in addition to per-month per-user caps? (E.g., a photographer on Pro could theoretically index 100 k faces in one event — is that fine, or do we want a per-event ceiling?)
- Do we surface usage to the photographer (banner: "1,243 / 5,000 faces indexed this month")? If so, we need a read endpoint that returns current usage — easy with the `get_ai_search_usage_count`-style RPC pattern.

---

## 10. Internationalization

### What exists today

- **Only two locale sources:** `dictionaries/en.json` and `dictionaries/es.json`. No ICU files, no message catalogs, no separate translation tooling.
- **Typed via re-export of the EN file** — `lib/i18n/get-dictionary.ts:1-4`:
  ```
  import type enDict from '@/dictionaries/en.json';
  export type Dictionary = typeof enDict;
  ```
  TypeScript autocomplete works through `dict.events.statusUpcoming`; missing keys fail at type-check time.
- **Server components:** `await getDictionary(locale)` from `lib/i18n/get-dictionary.ts:6-8`.
- **Client components:** `useTranslations<Dictionary>()` from `lib/i18n/translations-provider.tsx:22-34`; provider wraps the subtree with `<TranslationsProvider translations={dict}>`.
- **Naming convention:** camelCase, nested under a feature namespace. Examples: `events.statusUpcoming`, `eventCard.comingSoon`, `cart.title`, `checkout.successTitle`. Plurals use sibling keys (`events.photo` / `events.photos`) or templates (`events.nPhotosSelected`).

### Implications for the AI feature

New copy needed at minimum:
- Status strings ("Indexing", "Indexed", "Failed", "Quota exceeded", "AI matching disabled")
- Form labels and helper text ("Enable AI matching", "This event contains minors")
- Error/disclaimer copy ("Selfie is processed but not stored", "Upgrade to Pro to enable AI matching on more events")
- Admin/photographer dashboard chips

### Recommended approach

- Add a top-level `"rekognition"` (or `"aiMatching"`) namespace to **both** `en.json` and `es.json` in the same commit. Nested camelCase: `rekognition.status.indexing`, `rekognition.errors.quotaExceeded`, `rekognition.form.enableLabel`, `rekognition.form.minorsLabel`.
- Reuse `events.*` for fields that live in the event form (`events.aiMatchingEnabled`) only if they're tightly coupled to the form section; otherwise prefer the dedicated namespace.

### Open questions

- Do we need a third locale near-term? (No signal in the codebase.) The typed-dictionary pattern would require adding the new file and validating its shape matches.

---

## 11. Stripe / subscription plan checks

### What exists today

- **Plan model** — `lib/plans.ts`:
  ```ts
  type PlanId = 'free' | 'starter' | 'pro';
  interface Plan {
    id: PlanId; name: string; price: number | null; priceInterval: 'month'|'year'|null;
    storageGB: number | null; maxEvents: number | null; salesFeePercent: number;
    allowCustomBundles: boolean; features: PlanFeature[];
  }
  ```
  Tiers: **Free** (20 GB, max 3 events, 15 % fee), **Starter** (50 GB, 200 events, 8 %), **Pro** (250 GB, unlimited events, 5 %). Note: CLAUDE.md says 12/8/5 % — there's a doc/code drift to flag separately.
- **Helpers** — `database/queries/subscriptions.ts`:
  - `getCurrentPlan(supabase, userId)` (lines 60-74) — returns the `Plan` object, falls back to Free.
  - `getSubscription(supabase, userId)` (lines 35-53) — returns the row with `plan_id` and status.
  - `getPhotographerPlanIds(supabase, photographerIds)` (lines 80-101) — bulk Map lookup.
- **Stripe price → plan mapping:** `lib/stripe/plans-stripe.ts` maps `STRIPE_PRICE_AMATEUR → 'starter'`, `STRIPE_PRICE_PRO → 'pro'`. Updated by the webhook (`app/api/stripe/webhook/route.ts:571-572`).
- **AI rate-limits scaffolding (pre-existing, unused on `main`):** `lib/ai/rate-limits.ts` declares `free: 3 searches/mo, starter: 20/mo, pro: unlimited` — same shape we'd extend for face matching.
- **⚠️ Enforcement gap:** plan limits are **declared but not enforced**. `maxEvents` on Free is never checked in `createEvent`. Storage limit is shown as a meter but no hard block on upload. The interface promises a quota the codebase doesn't actually enforce.

### Implications for the AI feature

- The user's brief says "AI matching available on all plans but with event/storage limits enforced by plan." This implies we'll need to:
  1. Actually enforce existing `maxEvents` / storage caps when AI is enabled — currently a regression risk if a Free user creates 100 events that all hit AI indexing.
  2. Add new plan-tier limits for AI: per-month face-index count, per-month talent searches, maybe per-event maximums.
- The natural place to check is **at the start of the server action**: `getCurrentPlan(supabase, user.id)` → check usage → throw or proceed. Mirrors the existing `lib/ai/rate-limits.ts` structure.

### Recommended approach

1. Extend `lib/plans.ts` `Plan` interface with `aiIndexingPerMonth: number | null` and `aiSearchesPerMonth: number | null`. Populate per tier.
2. Extend `lib/ai/rate-limits.ts` (already structured for tier-based monthly quotas) to cover indexing as well as search.
3. Enforce in the server action: `getCurrentPlan() → getRekognitionUsage() → if (count >= plan.aiIndexingPerMonth) throw new PlanLimitError('upgrade')`.
4. Separately, tackle the **existing** `maxEvents` enforcement gap before launching AI — otherwise a Free user can dodge the AI limit by creating 100 events. (Could be a follow-up PR but worth flagging in the plan.)

### Open questions

- The Free plan: AI on/off entirely, or limited? The brief says "available on all plans" — does Free get a token allowance (e.g., 50 faces/month) or just access without quota until they hit storage/event caps?
- Do we backfill `maxEvents` enforcement *before* shipping AI, or alongside it?
- Is the per-photographer-per-month indexing limit reset by Stripe billing cycle (variable) or calendar month (simple)? Existing `ai_search_usage` uses calendar month — keeping that is simpler.

---

## Cross-cutting risks & flags

1. **No background job infrastructure today.** Section 5 is the biggest architectural decision. Vercel + Inngest is the path of least resistance; the alternative (Next.js `after()`) is a viable v0.
2. **Existing plan limits aren't enforced** (Section 11). The AI feature should not bolt new quotas on top of broken old ones — fix `maxEvents` enforcement in the same epic.
3. **Selfie upload path on the abandoned UI trusts client MIME** (audit §5). The new Rekognition selfie flow MUST go through `lib/photo-upload.ts:validatePhotoUpload`.
4. **Dead AI schema in production** (audit §2): `photo_embeddings`, `photos.photo_hash`, `photos.color_signature`, the broken `search_photos_by_similarity` overload. The Rekognition rebuild should include a cleanup migration so we don't carry two parallel AI schemas.
5. **Doc drift in `lib/plans.ts`** — sales-fee percentages disagree with CLAUDE.md (12/8/5 vs. 15/8/5). Flag for a separate fix; pick a source of truth before launching pricing pages that reference plan fees alongside AI features.
6. **Vercel tier unknown.** If Hobby (60 s), inline bulk indexing is not viable; if Pro (300 s), there's more headroom but still favor a queue.

---

## Files you'll touch (quick reference)

| Area | Path |
|---|---|
| Upload server action (queue hook point) | `app/[lang]/dashboard/photographer/events/[id]/actions.ts:244` |
| Photo validation | `lib/photo-upload.ts` (reuse for selfies too) |
| Event create form | `app/[lang]/dashboard/photographer/events/new/wizard.schema.ts`, `steps/step-1-config.tsx` |
| Event edit form | `app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-schema.ts` |
| Event detail page (status surface) | `app/[lang]/dashboard/photographer/events/[id]/page.tsx` |
| Storage fetch (worker side) | `database/supabase-admin.ts`, `database/queries/storage.ts` |
| Env validation | `env.mjs` |
| New migrations | `supabase/migrations/` (follow `20260514000000_create_rate_limit_buckets.sql` template) |
| New queries | new `database/queries/rekognition.ts` |
| Plan limits | `lib/plans.ts`, `lib/ai/rate-limits.ts`, `database/queries/subscriptions.ts` |
| Translations | `dictionaries/en.json`, `dictionaries/es.json` (new `rekognition` namespace) |
| Rate limiting | `lib/rate-limit.ts` (burst), `ai-search-usage`-style RPC (monthly quota) |
| Auth check | inline `getActiveRole()` + `eventExists()` (existing pattern) |
| Queue (greenfield) | TBD — Inngest recommended |

---

## Decisions the architecture plan must resolve

These are not code questions — they need user input before design:

1. **Background processing**: Inngest, `after()`, or inline-sync? (Section 5)
2. **Vercel tier**: Hobby or Pro? (affects timeout budget; Section 5)
3. **Free-tier AI policy**: hard quota, soft limits via existing event/storage caps, or no AI at all on Free? (Section 11)
4. **`contains_minors` semantics**: immutable post-creation, or editable with consequences? (Section 2)
5. **Re-index trigger**: automatic only on upload, or user-initiated "Re-index event" button? (Section 3 & 5)
6. **Selfie privacy copy** for the talent-side flow — "stored vs. not stored" disclaimer location and tone. (Section 10)
7. **Cleanup scope**: include the dead AI schema removal (audit §2) in this work, or separate? (Section 7, cross-cutting flag #4)
