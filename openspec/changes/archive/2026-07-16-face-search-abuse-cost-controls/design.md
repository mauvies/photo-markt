## Context

`searchFacesInEvent` (`src/app/[lang]/events/[shareCode]/actions.ts`) is the sole anonymous path to AWS Rekognition `SearchFacesByImage`. Rekognition has **no AWS-side spend ceiling**, so the backend chokepoint is our only cost control. Today it enforces one limiter: a per-`(shareCode, IP)` cap of 10 searches/hour, backed by the `rate_limit_buckets` table + the `increment_rate_limit_bucket` SECURITY DEFINER RPC (`src/lib/rate-limit.ts`, `pgBackend`). That limiter **is** Postgres-backed and atomic (single-statement upsert with `RETURNING`) — confirmed by reading the code; it is not in-memory. Its gap: an attacker rotating residential-proxy IPs evades the per-IP tier, leaving exposure effectively unbounded.

Legitimate traffic today is ≈ 0, but the first real 300-runner event means ~300 athletes searching — that is real traffic a too-tight cap would break. So caps must be low-by-default yet trivially configurable.

## Goals / Non-Goals

**Goals:**
- A hard, configurable **global daily** ceiling on AWS face-search spend (circuit breaker).
- A per-**event daily** cap so an attack on one event can't tumble the whole platform.
- Atomic, concurrency-correct counters that increment **before** the AWS call and count **real** billable AWS calls.
- A 50%-of-global email alert, fired at most once per day-window.
- Graceful, localized degradation that isolates a breaker trip from bib search and other events.

**Non-Goals:**
- CAPTCHA / bot-detection (the control that actually defeats IP rotation) — deferred to T-141; not even a flagged-off stub.
- Per-plan monthly search quotas (removed in T-036; the searcher isn't the plan owner).
- Cost limiting on the authenticated photographer indexing / bib-detection paths — those sit behind an authenticated upload, a much harder surface to abuse. (Optional visibility only; out of scope here.)
- Redis / new infra — Postgres counters only.

## Decisions

### D1 — Reuse `rate_limit_buckets`; add an increment-by-N RPC
The new daily counters are the same shape as the existing hourly bucket: `(bucket_key, window_start) → count`. Reuse the table and its RLS-off / service-role-only / SECURITY-DEFINER pattern. The existing `increment_rate_limit_bucket` increments by a hardcoded `+1`; the cost tiers must increment by `AWS_CALLS_PER_FACE_SEARCH`, so add a sibling `increment_rate_limit_bucket_by(p_bucket_key, p_window_start, p_amount)` returning the new count. The existing RPC is left untouched (its other call sites — load-more, bib-search, download, guest-upload, checkout — keep working). Execute is revoked from `anon`/`authenticated` and granted to `service_role`/`postgres`, matching the sibling migration.
- *Alternative rejected:* a bespoke counters table — needless; the bucket shape already fits and the RLS pattern is proven.

### D2 — Count real AWS calls via `AWS_CALLS_PER_FACE_SEARCH = 1` (corrects the ticket)
The ticket assumed a face search chains `DetectFaces` + `SearchFacesByImage` = 2 billable calls. **The code makes exactly one call** — `SearchFacesByImageCommand` (`src/lib/aws/face-indexing.ts`), which bundles face detection + collection search into a single billed Rekognition operation. There is no separate `DetectFaces` call. So the honest count is **1**, expressed as a named constant so the cost accounting updates in one place if a second billable call is ever added. Incrementing by this constant makes the global cap read directly as "N AWS calls/day".
- *Why not just hardcode 2 to match the ticket:* it would double-count against reality and make the global cap mean half its configured value. Faithfulness to the actual billable surface wins; the constant + comment + PR note make the deviation explicit and one-line-adjustable.

### D3 — Increment order: cheap/narrow tiers first, short-circuit before touching the breaker
Enforcement order inside `searchFacesInEvent`:
1. Resolve event + Rekognition state (existing).
2. **Tier 1** per-`(event, IP)`/hour throttle (existing `rateLimit`, increment 1). Reject → stop.
3. Validate selfie (`validatePhotoUpload`) and prep image. Reject → stop.
4. **Tier 2** per-event/day cost counter (`rateLimitCost`, increment `AWS_CALLS_PER_FACE_SEARCH`). Reject → `unavailable`.
5. **Tier 3** global/day cost counter (`rateLimitCost`). Reject → `unavailable`.
6. **50% alert** claim (only when the global count is ≥ 50% of cap).
7. AWS `SearchFacesByImage`.

Two ordering invariants matter:
- **Tier 1 before the cost counters** so an IP-throttled attacker's rejected requests never inflate the global breaker — otherwise cheap (no-AWS-cost) rejected requests could trip the breaker and deny face search platform-wide (a griefing DoS on the circuit breaker).
- **Selfie validation before the cost counters** so garbage payloads that never reach AWS can't inflate the breaker either.

This keeps the cost counters a faithful proxy for "requests that will actually call AWS." Rejecting *after* incrementing a broader tier (tier 2 passes, tier 3 trips) over-counts harmlessly — being conservative about cost is free (ticket's own guidance).

### D4 — Increment-before-AWS with the returned count; fail **closed**
`rateLimitCost` performs the atomic upsert (increment) and evaluates `count <= limit` on the **returned** value. Placing this immediately before the AWS call defeats the concurrent-burst race (N requests can't all sail past a not-yet-incremented counter): each concurrent request gets a distinct monotonic count from the single-statement RPC, and those over the cap are refused before their AWS call. Unlike the throttle `rateLimit` (which fails **open** — availability over strictness), `rateLimitCost` fails **closed**: it is a spend breaker, so if the counter storage errors we refuse rather than let a DB hiccup silently uncap the AWS bill (the exact hole this ticket closes). Face search degrades to "temporarily unavailable" during a counter outage; bib search + the rest of the app are untouched. *(Hardened after the `/code-review high` pass — the two limiter paths now differ by fail-mode, which is also why they're deliberately not unified.)*

### D5 — 50% alert dedup via an atomic claim bucket
Tracking "already alerted this window" in process memory is unreliable across serverless instances (each would email once). Instead, when the post-increment global count is ≥ `ceil(cap/2)`, atomically claim `face-search-alert:global-50:<dayWindowISO>` via the existing increment-by-1 RPC; only the caller that gets count `1` sends the email. This guarantees exactly one email per day-window across all instances. Recipient is `FACE_SEARCH_ALERT_EMAIL` (optional — absent ⇒ no-op, like `SENTRY_DSN`/`HEALTH_CHECK_TOKEN`); FROM reuses the existing `noreply@photomarkt.com` sender. The email is best-effort: a Resend failure is caught and logged, never blocking the search.

### D6 — Degradation surface
Breaker trips throw a parseable message `RATE_LIMIT:face-search:unavailable` (both tier 2 and tier 3 — the UI needn't distinguish event vs global; the server logs which tripped). The existing tier-1 message stays `RATE_LIMIT:face-search:exhausted`. `face-search-shared.ts` gains `isFaceSearchUnavailableError`; the modal renders new localized `errorUnavailable` copy. Bib search is untouched (separate action, no AWS), so it degrades independently by construction.

### D7 — Config as pure, testable helpers
`src/lib/face-search-limits.ts` holds `AWS_CALLS_PER_FACE_SEARCH`, `getFaceSearchLimits()` (reads env caps with defaults), the tier key builders (`eventDailyKey`, `globalDailyKey`, `alertClaimKey`), and the `shouldAlertAtFiftyPercent(count, cap)` predicate — all pure, unit-tested without a DB. Defaults: global 2000 calls/day, per-event 1000 calls/day (both env-overridable).

## Risks / Trade-offs

- **[A too-low cap breaks the first real event]** → Defaults are documented as deliberately conservative; the 50% alert gives advance warning to raise `FACE_SEARCH_GLOBAL_DAILY_CALLS` / `FACE_SEARCH_EVENT_DAILY_CALLS` before real users are blocked. Raising a cap is an env change, no deploy of logic.
- **[Fail-closed on counter backend outage]** → `rateLimitCost` fails **closed** (D4): during a counter-storage outage face search is refused (spend stays bounded) rather than served uncapped. Face search alone degrades; everything else works. Sentry-reported (throttled).
- **[Extra RPC round-trips per search]** → tiers 2 & 3 add two upserts; the alert adds one more past 50%. At ≤ a few thousand/day these are trivial single-statement calls. Acceptable.

### Review dispositions (`/code-review high`) — accepted, by design

- **[Global/per-event cap is weaponizable into an availability-DoS]** (findings [0]/[2]) → *inherent to any hard cost cap*, and exactly the tiered design the ticket specifies (per-event contains an event-targeted attack; global is the platform-wide spend ceiling). Because IPs rotate trivially, an aggregate per-IP tier wouldn't stop it either — the ticket's own reasoning — so the real anti-automation control (CAPTCHA) is **deferred to T-141**. Max exposure stays ~$2/day; bib search + the rest of the app are unaffected; only face search degrades.
- **[Counter drift under sustained post-trip load blunts a mid-day cap raise]** (finding [3]) → the **50% alert is the intended intervention point** — the counter is accurate there (below cap), so ops raise the cap *before* the trip and before any drift. Post-trip drift is bounded in practice (blocked users stop retrying) and the daily window resets at the UTC boundary regardless. Raising a cap during an *active* attack (the only time drift is large) is the wrong response anyway.
- **[Duplicate 50% alert email if the claim RPC fails open mid-transient]** (finding [5]) → accepted: a duplicate *ops* email during a brief DB error is harmless, and strictly better than failing the claim closed (which would suppress the early warning — the alert's whole purpose).

## Migration Plan

1. Ship migration `..._add_increment_rate_limit_bucket_by.sql` (additive: new function + grants only; no table/column change, no data migration). Rollback = `drop function` — inert, nothing depends on it until the new code ships.
2. The Vercel preview build queries prod Supabase, so the preview build stays red until the migration is applied to prod; `migrate.yml` applies it on merge to `main` (known pattern — see prior migration tickets).
3. Env vars are optional with safe defaults; no env change is required to deploy (defaults enforce the caps; alert stays off until `FACE_SEARCH_ALERT_EMAIL` is set).
