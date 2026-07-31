# Caching Audit — Full-Stack (T-083)

**Date:** 2026-07-08 · **Scope:** all 7 caching layers, current state on `main` (post-T-078)
**Type:** investigation/report only — **no code changes**. Every improvement below is scoped as a
standalone ticket candidate to be captured via `/ticket` and approved individually.

Related tickets referenced (not replaced) by this audit: **T-001** (Inngest concurrency after Pro),
**T-034** (face-search anti-abuse/quota redesign — blocked on product decision), **T-064** (event
photo cache tags), **T-067/T-068/T-078** (watermark/thumbnail pipeline).

---

## Executive summary

The caching architecture is fundamentally sound: the thumbnail pipeline delivers its intended
zero-egress steady state (T-057/T-060/T-078 verified end-to-end), server caches never mix
per-user data into shared scopes, every signed URL embedded in a cache outlives that cache's
TTL (one exception, F-06), and the rate limiter is atomic and multi-instance-correct.

The real problems cluster in four places:

1. **Invalidation gaps** — several mutations don't bust every tag that embeds their data. One is
   a genuine bug (deleted events linger on public photographer profiles → 404 clicks, F-01).
2. **Paid-API redundancy in background jobs** — re-indexing an event duplicates AWS face records,
   re-pays `DetectText`, and re-bakes ready thumbnails (F-11/F-12/F-14).
3. **Missing per-request auth memoization** — one dashboard render makes ~6 network round-trips
   to Supabase Auth (F-19).
4. **Aggregates computed by pulling full row sets** — the home page pulls every photo row of 50
   events to compute a count and pick a cover; sales dashboards fetch all order rows and sum in
   JS; the hottest gallery query has no matching index (F-24/F-25/F-27).

Abuse-surface honorable mention: guest Stripe checkout is unauthenticated and unlimited (F-15),
and the per-IP rate-limit key is client-spoofable via `x-forwarded-for` (F-16).

**Verified good (do not change):** see [§10](#10-verified-good--preserve).

---

## 1. Layer 1 — Server-side Next.js caching

No `unstable_cache`, no `fetch(..., {next})`, and no React `cache()` exist anywhere (grep-confirmed).
All server caching uses the `'use cache'` directive + `cacheTag`/`cacheLife`.

### Inventory

| Cached function | file | TTL (revalidate/expire) | Tags | Assessment |
|---|---|---|---|---|
| `getCachedTopEvents` | `src/app/[lang]/top-events-actions.ts:37` | 55m / 55m | `top-events` | good |
| `getCachedDictionary` | `src/app/[lang]/page.tsx:15` | `max` | `dict-${lang}` | good (static) |
| `getCachedEventData` (public detail) | `src/app/[lang]/events/[shareCode]/page.tsx:92` | 55m / 55m | `event-${param}`, `events-public` | good; over-broad tag (F-07) |
| `getCachedTalentEventData` | `src/app/[lang]/dashboard/talent/events/[id]/page.tsx:56` | 55m / 55m | `event-${param}`, `events-public` | good; keyed by `viewerIsTalent`; over-broad tag (F-07) |
| `searchEventsAction` | `src/app/[lang]/dashboard/talent/events/actions.ts:36` | 2m / 2m | `search-results`, `events-public` | good |
| `getFilterOptionsAction` | `src/app/[lang]/dashboard/talent/events/actions.ts:132` | `hours` | `filter-options`, `events-public` | good |
| `getPhotographerProfileAction` | `src/app/[lang]/photographer/[slug]/actions.ts:19` | 15m / 15m | `photographer-${slug}` | needs tuning (F-03) |
| `getPhotographerEventsAction` | `src/app/[lang]/photographer/[slug]/actions.ts:31` | 15m / 15m | `photographer-${slug}` | needs tuning (F-01) |
| `getCachedEventsData` (owner dashboard list) | `src/app/[lang]/dashboard/photographer/events/page.tsx:41` | 50m / **no expire** | `photographer-events-${userId}` | **risky** (F-06) |
| `getCachedDashboardData` | `src/app/[lang]/dashboard/photographer/actions.ts:154` | `minutes` | `dashboard-photographer-${userId}`, `photographer-events-${userId}` | ok |
| `getCachedEarningsSeries` | `src/app/[lang]/dashboard/photographer/actions.ts:343` | `minutes` | `dashboard-chart-${userId}-${range}` | needs tuning (F-05b) |
| `sitemap.ts` | `src/app/sitemap.ts:5` | **none** | — | **missing** (F-04) |

`force-dynamic` opt-outs (health endpoints, `dashboard/page.tsx`, cart, admin status) are all
correct — per-user or live data.

### Findings

- **F-01 · BUG — event edit/delete never revalidates `photographer-${slug}`.**
  `revalidateAfterEventMutation` (`src/app/[lang]/dashboard/photographer/events/[id]/edit/actions.ts:90-111`)
  and `deleteEventAction` (`src/app/[lang]/dashboard/photographer/events/actions.ts:81-102`) omit the
  tag; event **create** includes it (`events/new/actions.ts:145`), so the omission is clearly an
  oversight. Impact: **a deleted event's card stays on the public `/photographer/[slug]` profile for
  up to 15 min → click-through 404**; edits (name/date/cover) show stale for 15 min.
- **F-02 · RISK — photo mutations never bust listing tags.** Upload
  (`upload-urls/actions.ts:305-315`), approve/reject (`events/[id]/actions.ts:494,528` via
  `revalidateEventPhotoCacheTags:42-52`), contributor delete
  (`events/[shareCode]/actions.ts:113-119`), and the Inngest workers
  (`generate-photo-thumbnails.ts:84-88`, `index-photo-faces.ts:198-202`) revalidate only
  `event-${id|slug|shareCode}` — never `top-events` / `events-public` / `photographer-${slug}` /
  `photographer-events-${userId}`. A newly-photographed event's cover/photoCount/home-eligibility
  (the `count >= 1` filter, `top-events-actions.ts:65`) lags up to 55 min on home, 15 min on the
  photographer profile, 50 min on the owner's own dashboard list. Asymmetric: owner photo *delete*
  (`edit/actions.ts:291`) **does** bust the listing tags — evidence the omission is unintentional.
- **F-03 · RISK (low) — photographer rename stale in embedded copies.** Profile update busts only
  `photographer-${slug}` (`profile/update-action.ts:56-61`), but `photographerUsername`/
  `photographerDisplayName` are embedded in `top-events` (55m) and `search-results` (2m)
  (`top-events-actions.ts:139-140`, `talent/events/actions.ts:122-123`).
- **F-04 · RISK — sitemap is an uncached full-table scan.** `src/app/sitemap.ts:5` queries all
  public events on **every** crawler request; no `'use cache'`, no `revalidate`.
- **F-05 · RISK (low) — sales caches have no invalidation writer.** The Stripe webhook only calls
  `revalidatePath` on cart/orders/profile (`api/stripe/webhook/route.ts:462-464`); (a) the dashboard
  KPIs and (b) `dashboard-chart-${userId}-${range}` (`actions.ts:343`) refresh only by TTL. Fine
  while the profile is `'minutes'`; becomes a correctness gap if that window is ever widened.
- **F-06 · RISK — owner dashboard list can serve expired signed URLs.**
  `getCachedEventsData` (`dashboard/photographer/events/page.tsx:43`) sets
  `cacheLife({ revalidate: 60*50 })` with **no `expire`**, while embedding 55-min signed covers
  (`SIGNED_URL_TTL`, line 34). Stale-while-revalidate can serve an entry past 55 min → broken
  images. Every public cache sets `expire === revalidate`; this one should too.
- **F-07 · OPTIMIZATION — over-broad `events-public` tag on detail caches.** Both event-detail
  caches carry `events-public` (`events/[shareCode]/page.tsx:93`, `talent/events/[id]/page.tsx:57`)
  in addition to their scoped `event-${param}`. Any single event create/edit/delete nukes the cached
  detail of **all** events + search + filters at once. Dropping `events-public` from the two detail
  caches preserves correctness (the per-event tag already covers them) and protects hit rate.
- **F-08 · BUG (latent, dead code) — `deletePhoto` in `events/actions.ts:106-146`** revalidates only
  `event-${id}` (never slug/shareCode variants) — exactly the leak `revalidateEventPhotoCacheTags`
  exists to prevent. It has **no importers** (live path is `deletePhotoAction` in `edit/actions.ts`,
  which is correct). Delete the dead function before someone wires it.

**Verified clean:** no `cookies()`/`headers()`/`auth.getUser()` inside any `'use cache'` scope;
per-user caches keyed by `userId` resolved outside; talent detail keyed by `viewerIsTalent` so
watermarked/clean variants can't cross. **No cache-poisoning or data-leak risk found.**

---

## 2. Layer 2 — Client-side caching (React Query)

React Query **is** installed and used (`@tanstack/react-query ^5.101.0`, `package.json:47`;
provider at `src/components/query-provider.tsx`, mounted in `src/app/[lang]/layout.tsx:37`).
Global defaults: `staleTime 60s`, `gcTime 5min`, `refetchOnWindowFocus false`, `retry 1`.
No `useInfiniteQuery` anywhere — load-more is homemade `useState` accumulation.

### Inventory

| Query key | file | Config | Assessment |
|---|---|---|---|
| `['events', {filters}]` | `src/hooks/use-event-search.ts:167` | 60s stale, `keepPreviousData`, seeded `initialData` | good; pages 2+ outside RQ (F-10) |
| `['cart-count']` | `src/hooks/use-cart-item-count.ts:12` | 30s, focus-refetch **on** | intentional freshness |
| `['cart-data']` | `dashboard/talent/cart/cart-content.tsx:85` | **`staleTime: Infinity`** | cross-tab staleness (F-31) |
| `['cart-merge-state']` | `cart-content.tsx:95` | Infinity; RQ cache as state bus + 6s timeout | works; smell (F-33) |
| `['saved-events']` | `src/hooks/use-saved-events.ts:29` | 5min, auth-gated, optimistic toggle | good |
| `['auth-user']` | `src/hooks/use-auth-user.ts:25` | 5min, synced via `onAuthStateChange` | good |
| `['sales', {timeRange}]` / `['earnings']` | sales/earnings content | 2min | good |

Non-RQ client state: guest cart in localStorage (`guest-cart-provider.tsx:27-48`), guest upload
tokens, event-wizard draft in sessionStorage (all fine); face-search results in plain `useState`
(F-32); homemade paginators (F-10). Query-key hygiene is clean — no colliding keys.

### Findings

- **F-09 · BUG (perf) — add-to-cart double-refresh.** `src/components/add-to-cart-button.tsx:59-61,83-85`
  calls **both** `invalidateQueries(['cart-count'])` **and** `router.refresh()` per click — a full
  RSC re-render of the page subtree on a hot path. The optimistic sibling
  (`use-optimistic-photos-in-cart.ts`) deliberately skips `router.refresh()`; the two add-to-cart
  implementations are inconsistent.
- **F-10 · RISK (UX/waste) — load-more pages lost on back-navigation.**
  `use-load-more-photos.ts:53` and `use-event-search.ts:201-240` hold accumulated pages in
  component `useState` outside RQ; page 1 survives (server-seeded), pages 2..N are re-fetched
  (each a server-action call) when the user returns.
- **F-31 · RISK (low) — `['cart-data']` `staleTime: Infinity`, focus-refetch off:** cart changed in
  another tab/device (or by the Stripe webhook's `revalidatePath`) stays stale until hard reload.
- **F-32 · RISK — face-search results ephemeral.** `event-gallery-with-face-search.tsx:109-139`
  keeps AI match results in `useState`; any navigation drops them and the user must re-upload a
  selfie and re-pay a Rekognition search. (Pairs with F-13 — there is no server-side result cache
  either.)
- **F-33 · OPTIMIZATION —** `['cart-merge-state']` uses the RQ cache as a boolean event bus with a
  6-second `setTimeout` safety net (`cart-content.tsx:69-71`); minor stacked-caches note: search
  results can lag a publish by ≤60s client-side after the server tag is busted (acceptable).

---

## 3. Layer 3 — Image caching (CDN/HTTP)

**Serving chains:** (a) thumbnails `/api/thumb` — `public, max-age=31536000, s-maxage=31536000,
immutable` (`route.ts:75`), Supabase hit once per object then Vercel edge forever; (b) watermark
previews `/api/watermark` — `public, max-age=86400, s-maxage=86400` (`route.ts:144`), full original
download + Sharp per cache-miss; (c) purchased originals — 300–600s signed URLs, `unoptimized`;
(d) covers — 60-min signed URLs inside 55-min caches; (e) avatars — Google URLs.

**T-078 verified complete:** `?v=` cache-bust wiring reaches every thumb-URL builder call site
(`photo-album-item.ts:92-102`, `top-events-actions.ts:137`, `talent/events/actions.ts:119`,
`photographer/[slug]/actions.ts:116`); the route correctly ignores the param (CDN-key only);
cardinality bounded by `thumb_version`. **No stale-after-rebake gap remains.**

**Signed-URL/TTL alignment verified** across all cached payloads (55m cache / 60m URLs; 50m/55m;
15m/60m; 2m/60m). The only mismatch is F-06 (Layer 1, missing hard `expire`).

### Findings

- **F-21 · RISK — double image optimization on the two highest-volume surfaces.** The gallery grid
  (`photo-album-viewer.tsx:440`) and event covers (`event-card.tsx:243`) render `<Image>` **without**
  `unoptimized`, so pre-baked `/api/thumb` WebP is re-encoded through Vercel `/_next/image` —
  wasted CPU and Hobby image-transformation quota; defeats the pre-bake. The carousel already does
  it right (`photo-carousel.tsx:164` — `unoptimized` for `/api/` sources). Inconsistent; align.
- **F-22 · RISK — `/api/watermark` is public, unthrottled, and expensive per unique path.**
  No `rateLimit`, no `maxDuration` (`api/watermark/[...path]/route.ts`). Each distinct path is a
  fresh CDN key forcing one Supabase original download + one Sharp encode. Path enumeration is an
  egress + CPU amplification vector. (Also surfaced by Layer 5 as a coverage gap.)
- **F-23 · RISK (transient) — pre-bake thundering herd.** First view of a not-yet-baked paid
  gallery hits the watermark route once per visible tile (N downloads + N Sharp encodes), then
  24h edge-cached. Bounded but spiky; mostly mitigated by baking speed.
- **OPT — dead code:** `thumbUrl` (absolute builder, `thumbnails.ts`) has zero callers.
- **No action:** Supabase-side `cacheControl` on uploads is irrelevant (both proxy routes override
  headers); `formats`/`deviceSizes` defaults are fine unless grid/covers stay optimized.

---

## 4. Layer 4 — Background jobs (Inngest): idempotency & paid-call redundancy

| Function | Trigger | Concurrency | Expensive steps | Idempotency |
|---|---|---|---|---|
| `index-photo-faces` | `photo.uploaded` | 5/event (`:216`) | mega-step: download+Sharp+**IndexFaces** (`:344-457`) | step-memoized retries OK; **no DeleteFaces on re-index** (F-11) |
| `generate-photo-thumbnails` | `photo.processed` | 5/event | mega-step: download+watermark+blur+2×resize+2×upload | `upsert:true` retry-safe; **no `thumbnail_status` guard** (F-14) |
| `detect-photo-bibs` | `photo.uploaded` **+** `photo.bib-detect` (`:62`) | 5/event | download+Sharp+**DetectText** (`:103-130`) | persist idempotent; **re-pays DetectText on face re-index** (F-12) |
| `backfill-event-indexing` | `event.ai-matching-enabled` | **none** | fanout `photo.uploaded` (`:102-116`) | skips `indexed`/`no_faces`; **no serialization** (F-17) |
| `backfill-event-bib-detection` | `event.bib-detection-enabled` | **none** | fanout `photo.bib-detect` | correctly bib-scoped event; same no-cap concern |
| `disable-event-indexing` / `cleanup-on-event-delete` | disable / delete | none | DeleteCollection (idempotent) | clean |

### Findings

- **F-11 · BUG — re-index duplicates `photo_faces` rows and AWS collection faces.**
  `index-photo-faces` never calls `DeleteFaces` before re-indexing; `deleteFacesFromCollection`
  exists (`face-indexing.ts:148`) with **zero callers**. AWS mints a fresh `FaceId` per `IndexFaces`
  call, so the `unique (photo_id, aws_face_id)` constraint doesn't dedupe across runs, and
  `addPhotoFace` is a plain insert (`rekognition.ts:133`). Any `failed`/`indexing` photo with
  partially-persisted faces re-indexed via backfill accumulates rows + AWS storage cost. Search
  stays correct (deduped by `photo_id` at query time) — this is a cost/data-growth bug.
- **F-12 · BUG — face re-index re-pays `DetectText`.** `detect-photo-bibs` subscribes to
  `photo.uploaded` (`:62`) — the same event the face backfill fans out — and never checks the
  per-photo `bib_detection_status` (only the event-level flag, `:98`). Clicking "Re-index event"
  re-runs paid DetectText on every non-indexed photo. Worst case: disable→re-enable AI matching
  re-pays IndexFaces **and** DetectText **and** re-bakes every thumbnail event-wide. (The reverse
  direction is guarded: bib backfill uses its own `photo.bib-detect` event.)
- **F-13 · Answer to the ticket's saved-search question: there is NO search-result cache.**
  `searchFacesInEvent` (`events/[shareCode]/actions.ts:248`) calls AWS `SearchFacesByImage` on
  every invocation; nothing persists results; a repeat identical search re-pays AWS. Only the
  rate limiter (10/h per shareCode+IP) bounds spend. `photo_faces` caches **IndexFaces** output
  (face-id → photo-id mapping), not search results. Selfies confirmed ephemeral (by design).
  Note: `src/database/queries/ai-search-profiles.ts` and the saved-search filter files listed in
  CLAUDE.md **no longer exist** — the `ai_search_profiles` table is orphaned in the DB (zero code
  references). Doc drift + dead-table cleanup candidate.
- **F-14 · OPTIMIZATION — thumbnails re-baked when already `ready`.** `load-context`
  (`generate-photo-thumbnails.ts:66-75`) never checks `thumbnail_status`; any `photo.processed`
  re-emission re-downloads/re-Sharps/re-uploads and **bumps `thumb_version`, needlessly busting the
  immutable CDN entry** (interacts with T-078: harmless for correctness, wasteful for hit rate).
  Add a `ready` early-return with an explicit force flag for genuine re-bakes.
- **F-17 · RISK — no idempotency keys, no backfill serialization.** No `inngest.send()` anywhere
  passes an idempotency `id`; the two backfills have no concurrency cap. Two rapid "Re-index"
  clicks (`events/[id]/actions.ts:711-733`) → two concurrent fanouts → double AWS spend and
  compounded F-11 duplicates. Fix: `concurrency: [{limit:1, key:eventId}]` on backfills + an
  idempotency key on the enabling sends.
- **F-18 · RISK — silent wedges with no sweeper.** (a) `ai_matching_status` flips to `ready` only
  when in-flight count hits 0 (`index-photo-faces.ts:549-554`); one lost event ⇒ stuck `indexing`
  forever — the only recovery so far was a one-time manual migration
  (`20260519000002_recover_stuck_indexing_photos.sql`). (b) `emit-processed` is best-effort
  (`index-photo-faces.ts:557-576`); a dropped emit ⇒ thumbnail never bakes, gallery silently falls
  back to per-view `/api/watermark` (pays F-22's cost indefinitely). A periodic reconcile cron
  (Inngest cron) closes both.

---

## 5. Layer 5 — Rate limiting

**9 call sites** (not the 2 CLAUDE.md highlights), all on the atomic Postgres backend
(`increment_rate_limit_bucket`, single-statement `INSERT … ON CONFLICT … DO UPDATE` — correct
under concurrency; EXECUTE properly revoked). **No in-memory limiter anywhere** — multi-instance
safe. Backend pluggable via `RateLimitBackend` (`rate-limit.ts:29,76`).

| Endpoint | Key | Limit/window |
|---|---|---|
| Face search (`events/[shareCode]/actions.ts:284`) | `face-search:${shareCode}:${ip}` | 10/h |
| Bib search (`:472`) | `bib-search:${shareCode}:${ip}` | 30/h |
| Load-more (`:192`) | `load-more-photos:${event}:${ip}` | 60/h |
| Photo download (`:526`) | `photo-download:${uid ?? ip}` | 60/h |
| Bulk download (`api/events/[id]/download/route.ts:74`) | `event-download:${uid ?? ip}` | 30/h |
| Stripe checkout, authed (`api/stripe/checkout/route.ts:27`) | `stripe-checkout:${uid}` | 20/h |
| Admin payout (`api/admin/payouts/[id]/route.ts:28`) | `admin-payout:${uid}` | 30/min |
| Guest upload URLs (`upload-urls/actions.ts:295`) | `guest-upload-urls:${eventId}:${ip}` | 30/h |
| Health ready (`api/health/ready/route.ts:46`) | `health-ready:${ip}` | 20/h |

### Findings

- **F-15 · RISK (highest in this layer) — guest Stripe checkout is unauthenticated and unlimited.**
  `createGuestCheckoutSessionAction` (`src/app/[lang]/cart/actions.ts:16,76`) mints Stripe
  `checkout.sessions.create` (paid API) with no limiter. Mirror the authed `stripe-checkout`
  limiter keyed by IP.
- **F-16 · RISK — `getClientIp` trusts the leftmost `x-forwarded-for` value** (`rate-limit.ts:98`),
  which is client-controllable (Vercel appends the real IP on the right). An attacker rotates the
  per-IP key for free by varying one header, weakening limiters 1–3, 5, 8, 9. Key off `x-real-ip`
  (Vercel's edge-observed IP) or the rightmost XFF hop.
- **F-20 · RISK — fail-open is unmonitored.** Any backend error ⇒ `ok:true` with only a
  `console.error` (`rate-limit.ts:83`). A sustained DB outage silently disables every limiter
  (including the AWS-cost face-search one) with no Sentry event/metric.
- **RESOLVED (was: consistency risk) — `api/billing/checkout/route.ts`** (Stripe customer +
  subscription create, authed) had no limiter while its sibling `stripe/checkout` did. Fixed by
  **deletion**, not by adding a limiter: the route had zero callers and was superseded by
  `createBillingCheckoutAction` — see T-202. **RISK (low):**
  password-reset/login/signup rely solely on Supabase Auth's built-in throttles
  (`login/actions.ts:16`); authed feedback submit is unbounded (`actions/feedback.ts:15`).
- **F-26 · OPTIMIZATION — `rate_limit_buckets` has no pruning.** One row per (key, window),
  `window_start` index exists precisely for a future cleanup job that was never written; growth is
  attacker-amplifiable via F-16 (every forged XFF = new PK row). A daily
  `DELETE … WHERE window_start < now() - interval '2 hours'` bounds it fully.
- **Inherent:** fixed-window boundary burst allows up to 2× limit in ~2s at a window edge —
  disposition deferred to **T-034** (do not redesign here).

---

## 6. Layer 6 — Auth/session caching & per-request overhead

Key facts: Next 16 middleware is `src/proxy.ts`. **Every server-side auth check is
`supabase.auth.getUser()`** — a network round-trip to Supabase Auth (GoTrue). Zero uses of
`getSession()`/`getClaims()`; no JWT libs, no `SUPABASE_JWT_SECRET` — **no local verification path
exists**. No React `cache()` anywhere. All DB access is PostgREST-over-HTTP (no pg pool risk).

### Findings

- **F-19 · RISK (main finding) — ~6 GoTrue round-trips per authenticated dashboard render.**
  Middleware (`proxy.ts:91`) + layout (`dashboard/photographer/layout.tsx:19`) +
  `getActiveRoleOrNull` and `userHasRole` (each re-authenticating via `getAuthenticatedClient`,
  `roles.ts:37`, called from `:205`/`:216`) + page (`page.tsx:24`) + `getDashboardData`
  (`actions.ts:330`). The codebase **already ships the fix and documents the anti-pattern**:
  `getRoleContext()` (`roles.ts:221-241`) exists precisely to collapse the two role helpers into
  one round-trip — only `dashboard/page.tsx` uses it; both dashboard layouts (the hot path) don't.
  Plus `profiles` is read 2–3× per render (`layout.tsx:22`, `profiles.ts:127-135`, `page.tsx:28`).
  Fix: use `getRoleContext()` in layouts + wrap `createClient`/`getUser`/profile reads in React
  `cache()`.
- **RISK (mild) — authenticated users pay a GoTrue round-trip in middleware on every page**,
  including public ones (`proxy.ts:91`). Anonymous traffic is correctly exempted by the `sb-`
  cookie gate (`proxy.ts:62-66`) — the single most important mitigation, and it's already there.
- **F-30 · OPTIMIZATION (biggest lever at scale) — adopt `getClaims()` local JWT verification**
  (supported by `@supabase/ssr` 0.10 with asymmetric signing keys) to eliminate most GoTrue
  round-trips without adding a JWT dependency.
- **Minor bug:** `proxy.ts:121-122` deletes literal `sb-access-token`/`sb-refresh-token` cookie
  names, but supabase-ssr writes chunked `sb-<ref>-auth-token(.N)` — the deletes target
  non-existent cookies.
- **Fine as is:** `admin_users` per-request check on admin routes (low traffic, rate-limited);
  centralized refresh in middleware; `supabaseAdmin` module singleton.

---

## 7. Layer 7 — DB query patterns

### Findings

- **F-24 · RISK — the hottest read has no matching index.** Gallery pages query
  `event_id = X AND upload_status = 'approved' ORDER BY taken_at, id` + `.range()`. The only
  composite touching `upload_status` is partial `WHERE upload_status <> 'approved'` — it
  **explicitly excludes** the rows this query reads. Postgres falls back to the `(event_id)` index
  + an in-memory sort per page. Fix (cheap, high impact):
  `CREATE INDEX ... ON photos (event_id, taken_at, id) WHERE upload_status = 'approved'`.
  Also: `photos_event_idx` duplicates `photos_event_id_idx` — drop one.
- **F-25 · RISK — counts/covers computed by pulling full photo row sets.**
  `getPhotosForEventsIncludingPending` (`photos.ts:256-279`, no limit) is called with 50 event ids
  on every top-events cache miss (`top-events-actions.ts:45`) just to count photos and pick the
  first row as cover — thousands of rows to derive a count + a min. Same pattern drives the owner
  dashboard list, dashboard cards, and talent search. `getPhotoCountsForEvents` (`photos.ts:292-315`)
  also tallies in JS. Fix: grouped-count RPC + one-cover-per-event fetch
  (`DISTINCT ON (event_id)`).
- **F-27 · RISK — sales/earnings dashboards fetch all order rows and aggregate in JS, unbounded.**
  `getSalesSummary` (`sales.ts:71-142` — date filters applied in JS, not SQL), `getSalesOverTime`
  (`:192-274`), `getTopSellingPhotos` (`:279-383`), `getTopSellingEvents` (`:389-531`),
  `getTotalGrossEarnings` (`earnings.ts:29-51`); `getSalesSummaryWithTrend` (`sales.ts:160`) runs
  the full scan **twice** per dashboard load. Grows linearly with order volume. Fix: SQL
  aggregates (RPC or view — check whether the existing `photographer_sales_view` migration
  `20250214000000` is even used) + push date filters to `.gte/.lte`.
  Related: `getStorageUsageBytes` (`photos.ts:170-188`) sums `size_bytes` in JS (covering index
  makes the scan index-only; the transfer is the issue) — `sum()` RPC.
- **F-28 · RISK — cover-signing N+1 in six sites while the batch signer exists.**
  `createSignedUrls`/`createPhotoUrlMap` (`storage.ts:29,287`) is used correctly by the gallery
  pages, but six cover paths loop singular `createSignedUrl` per event:
  `dashboard/photographer/events/page.tsx:112-118` (**all** owner events, unbounded),
  `photographer/[slug]/actions.ts:100-107` (**all** public events, **uncached**),
  `talent/events/actions.ts:89-96`, `actions/saved-events.ts:142-148`,
  `top-events-actions.ts:105-111` (≤8), `dashboard/photographer/actions.ts:219-223,260-265` (≤5).
  A photographer with 80 events ⇒ 80 Storage round-trips on a cold render. Fix: one
  `createPhotoUrlMap` call per site.
- **F-29 · OPTIMIZATION — unbounded reads & wide selects.** `getEventFilterOptions`
  (`events.ts:481-507`) selects city/country of **all** public events per filter render (distinct
  RPC candidate); `getUserEvents` (`events.ts:56-75`) unbounded; hot single-row event reads use
  `select('*')` on a 25+-column row (`events.ts:115,234,255,294`, `events/[shareCode]/page.tsx:103`)
  — extend the `EVENT_PHOTO_PUBLIC_COLUMNS` column-list discipline to `events`. `generateMetadata`
  re-queries + re-signs an OG image the cached payload already computed
  (`events/[shareCode]/page.tsx:232-245`).
- **Healthy (do not change):** paginated galleries (`(taken_at, id)` order, `limit+1` over-fetch);
  batch signing on gallery pages; batched profile/email lookups (`.in()`, RPC) — no profile N+1;
  ZIP download signs per-photo **intentionally** (memory-bounded streaming); slug/share_code/face-id
  lookups all index-backed.

---

## 8. Prioritized improvement plan (ticket candidates)

Impact × effort, ordered. Each row is scoped to become one standalone ticket via `/ticket`,
with its own regression test (caching changes are silent — per the ticket's own rule).

| # | Candidate ticket | Findings | Impact | Effort | Class |
|---|---|---|---|---|---|
| 1 | Add `photographer-${slug}` to event edit/delete revalidation | F-01 | High (404s on public profile) | XS | bug |
| 2 | Rate-limit guest Stripe checkout (per-IP, mirror authed limiter) | F-15 | High (paid-API abuse) | XS | risk |
| 3 | `getClientIp`: key off `x-real-ip` / rightmost XFF | F-16 | High (restores limiter integrity) | XS | risk |
| 4 | Partial index `photos (event_id, taken_at, id) WHERE approved` + drop dup index | F-24 | High (hottest query) | S (migration) | risk |
| 5 | Photo mutations also revalidate listing tags (`top-events`, `events-public`, `photographer-*`) — extend `revalidateEventPhotoCacheTags` | F-02, F-05 | Med-high (55-min home lag) | S | risk |
| 6 | Serialize backfills (`concurrency limit:1 key:eventId`) + idempotency keys on enable-sends | F-17 | Med-high (double AWS spend) | S | risk |
| 7 | `detect-photo-bibs`: skip when `bib_detection_status` already set; stop paying DetectText on face re-index | F-12 | Med-high (paid API) | S | bug |
| 8 | DeleteFaces (or delete `photo_faces` rows) before re-index | F-11 | Med (AWS storage growth) | M | bug |
| 9 | `thumbnail_status='ready'` guard in `generate-photo-thumbnails` (+ force flag) | F-14 | Med (compute + CDN churn) | S | opt |
| 10 | `unoptimized` on grid/cover `<Image>` for `/api/` sources (match carousel) | F-21 | Med (Hobby quota) | XS | risk |
| 11 | Rate-limit `/api/watermark` (+ `maxDuration`) | F-22 | Med (egress/CPU abuse) | S | risk |
| 12 | Dashboard layouts → `getRoleContext()`; wrap `createClient`/`getUser`/profile reads in React `cache()` | F-19 | Med (6→1-2 auth RTs) | M | risk |
| 13 | Cache `sitemap.ts` (`'use cache'` + `events-public` tag) | F-04 | Med (crawler DB load) | XS | risk |
| 14 | Add `expire` to owner dashboard events cache | F-06 | Low-med (broken covers) | XS | risk |
| 15 | Batch cover signing via `createPhotoUrlMap` (6 sites; prioritize `photographer/[slug]`) | F-28 | Med | S | opt |
| 16 | Grouped-count + cover-only RPC replacing full row pulls | F-25 | Med-high at scale | M | opt |
| 17 | Sales/earnings: SQL aggregates + push date filters into query | F-27 | Med-high at scale | M-L | opt |
| 18 | `rate_limit_buckets` pruning cron (Inngest cron) | F-26 | Low now, needed at scale | S | opt |
| 19 | Sentry-alert on rate-limit fail-open | F-20 | Low-med (visibility) | XS | risk |
| 20 | Reconcile sweeper cron for wedged `indexing`/never-baked thumbnails | F-18 | Med (silent wedges) | M | risk |
| 21 | Drop `events-public` tag from the two event-detail caches | F-07 | Med (hit rate) | XS | opt |
| 22 | Fix add-to-cart double refresh (remove `router.refresh()`) | F-09 | Low-med (hot path) | XS | bug |
| 23 | Adopt `getClaims()` local JWT verification | F-30 | High at scale | M-L | opt |
| 24 | Cleanup: delete dead `deletePhoto` (F-08), dead `thumbUrl`, orphaned `ai_search_profiles` table, fix CLAUDE.md query-layer listing (F-13 note), fix proxy cookie names | F-08 et al. | Hygiene | S | opt |
| 25 | Limiters: `billing/checkout`, feedback, password-reset (app-level) | L5 minors | Low | S | risk |
| 26 | Rate-limit boundary burst + face-search result caching / quota model | F-13 | — | — | **→ T-034** (do not implement here) |

Items 1–4 are the "do these first" set: three one-liners and one migration, all with
disproportionate impact.

---

## 9. Scale readiness — what breaks first

Reasoned thresholds (architectural, not benchmarked):

1. **Supabase Auth (GoTrue) QPS — first practical ceiling for authenticated traffic.** Each
   authed page view fans out to ~6 `getUser()` network calls (F-19). At even ~10 req/s of authed
   dashboard traffic that's ~60 auth-server calls/s plus serial latency per render. Mitigations
   in order: #12 (per-request memoization, ~6→2), then #23 (`getClaims()`, →~0 network).
   Anonymous traffic is already protected by the cookie gate.
2. **Sales dashboards & aggregates — grow linearly with order/photo volume.** Full-scan JS
   aggregation (F-25/F-27) is invisible today and becomes the dashboard cost center around
   thousands of order_items per photographer / hundreds of photos per event × 50-event scans.
   The missing gallery index (F-24) makes every gallery page re-sort large events. These are the
   classic "worked fine until it didn't" items — #4/#16/#17 pre-empt them cheaply.
3. **AWS Rekognition spend under re-index churn.** F-11/F-12/F-17 mean administrative actions
   (re-index, disable/re-enable) multiply paid calls across whole events. At 5k-photo events, one
   careless double-click is 2× a full-event IndexFaces+DetectText bill. Fix before scale, not after.
4. **Inngest Free tier.** Per-event concurrency 5 is deliberate (T-001 raises it post-Pro); the
   real scale gap is the missing sweeper (F-18) — at volume, low-probability wedges become
   weekly occurrences with no recovery path.
5. **Vercel Hobby image-transformation quota.** F-21 burns transformations on already-optimized
   thumbs across the two highest-volume surfaces; quota exhaustion degrades images site-wide.
   One-line fix (#10).
6. **Egress re-emergence vectors.** Steady state is solved (thumbs, verified). The leaks that
   return with traffic: unthrottled `/api/watermark` enumeration (F-22), pre-bake herds on big
   uploads (F-23), signed-cover fallback for new events (self-heals on bake). #11 closes the
   abuse one.
7. **Cache stampede on popular events.** 55-min hard expiry on `top-events` and event-detail
   caches means expiry-moment concurrent misses each recompute the (aggregate-heavy, F-25)
   payload — Next dedupes per instance but not across serverless instances. Bounded today;
   #16 shrinks the recompute cost, which is the better lever than tuning TTLs.
8. **Rate-limiter integrity under abuse.** Spoofable IP keys (F-16) + unmonitored fail-open
   (F-20) + unbounded bucket growth (F-26) mean the abuse-protection layer degrades quietly
   exactly when attacked. #3/#18/#19 are cheap hardening. Postgres backend itself is fine to
   ~tens of increments/s; the pluggable `RateLimitBackend` makes a Redis swap a non-event later.

## 10. Verified good — preserve

- **Thumbnail pipeline end-to-end (T-057/T-060/T-068/T-078):** content-addressed, immutable 1y,
  `?v=` bust wiring complete at every call site, zero steady-state Supabase egress for baked
  galleries. The single most valuable caching asset in the app.
- **No cache poisoning:** no auth/cookies/headers inside any `'use cache'` scope; per-user caches
  keyed externally; talent variant keyed by `viewerIsTalent`.
- **Signed-URL/TTL discipline:** every public cache sets `expire === revalidate` under its URL
  expiry (except F-06).
- **Rate limiter core:** atomic RPC, EXECUTE lockdown, no in-memory state, pluggable backend.
- **Middleware anonymous gate** (`proxy.ts:62-66`) and matcher exclusions.
- **Gallery pagination** (`(taken_at, id)` + `limit+1`) and **batch URL signing** on gallery pages.
- **React Query setup:** sane defaults, clean key hygiene, optimistic cart with reconcile.
- **Bib backfill event separation** (`photo.bib-detect`) — the pattern F-12 should copy.

## 11. Out of scope / deliberately not recommended

- **Face-search quota/result-cache redesign** — belongs to **T-034** (product decision pending).
  This audit documents current state (F-13) and hands the cost data over; no design here.
- **Redis/Upstash migration now** — Postgres limiter is correct and sufficient at current scale;
  the backend interface already makes the swap trivial when needed. Premature.
- **Denormalized `photos_count`/`cover_path` on `events`** — highest-leverage structural fix for
  F-25 but the largest change; the grouped-count RPC (#16) buys most of the win at a fraction of
  the risk. Revisit only if #16 proves insufficient.
- **Edge runtime for `/api/thumb`** — irrelevant: after the first hit the CDN serves it; origin
  latency doesn't matter for immutable objects.
- **ZIP download per-photo signing loop** — intentional memory-bounded streaming; not an N+1.
- **`cacheControl` on Supabase Storage uploads** — cosmetic; both proxy routes override headers.
- **Sliding-window rate limiting** — the 2× boundary burst is acceptable at current limits;
  fold into T-034 if quotas change.
- **Converting load-more to `useInfiniteQuery`** (F-10) — real but low-pain UX polish; defer
  until gallery usage data justifies it.
- **TTL tuning of the 55-min caches** — windows are deliberately signed-URL-coupled and correct;
  invalidation gaps (F-01/F-02), not TTLs, are the staleness source. Fix the tags, keep the TTLs.
