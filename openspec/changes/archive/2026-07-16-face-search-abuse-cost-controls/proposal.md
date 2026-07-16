## Why

The anonymous face-search endpoint (`searchFacesInEvent`) calls AWS Rekognition `SearchFacesByImage`, which is **billed per call with no AWS-side spend ceiling**. Every Rekognition call is funneled through our backend, giving us a single chokepoint — but today the only limiter is a per-`(event, IP)` hourly throttle. An attacker who rotates IPs (residential proxies) evades that per-IP tier, so the maximum exposure is effectively an **unbounded AWS bill**. We need a hard, configurable ceiling on daily cost before we have real traffic to protect it.

## What Changes

- Add two new **atomic Postgres counter tiers** on top of the existing per-`(event, IP)`/hour throttle:
  - **Per-event/day** cost cap — contains an attack aimed at one event without tripping the whole platform.
  - **Global/day** circuit breaker — a hard daily ceiling on total AWS spend.
- Counters increment **atomically in one round-trip** (single-statement upsert with `RETURNING`), **before** the AWS call, and the decision uses the returned count. A new increment-**by-N** RPC is added alongside the existing increment-by-1 RPC, reusing the `rate_limit_buckets` table.
- Counters increment by the **real number of billable AWS calls** the operation makes, expressed as the named constant `AWS_CALLS_PER_FACE_SEARCH`. Our search makes exactly **one** billable Rekognition op (`SearchFacesByImage`, which bundles detection + collection search) — there is no separate `DetectFaces` call, so the constant is **1** (not 2 as the ticket assumed). Defined in one place so it stays correct if a second billable call is ever added.
- All caps are **configurable via env vars** (never hardcoded), starting deliberately low (~2000 global calls/day ≈ $2/day exposure).
- **Email alert at 50% of the global cap** (reuse Resend), deduped to fire **once per day-window** via an atomic claim bucket, so we hear about trouble — or the need to raise a cap — before the breaker trips.
- **Graceful degradation**: when a breaker trips, face search returns a dignified localized "temporarily unavailable" message (not an error). Bib search (a separate, non-AWS path) and the rest of the app are unaffected; a per-event trip affects **only that event**.
- Document that the existing per-`(event, IP)`/hour limiter is Postgres-backed and atomic (not in-memory).
- **Out of scope (deferred):** CAPTCHA on the anonymous face search — tripwire captured in T-141; do not pre-build it.

## Capabilities

### New Capabilities
- `face-search-abuse-controls`: Tiered, atomic, configurable rate/cost limiting for the anonymous face-search endpoint — per-`(event, IP)`/hour throttle, per-event/day cost cap, global/day circuit breaker, 50%-of-global email alert, and graceful degradation that isolates breaker trips from bib search and other events.

### Modified Capabilities
<!-- None — there is no existing face-search capability spec; the current limiter lives only in code. -->

## Impact

- **DB migration** (new): `increment_rate_limit_bucket_by(text, timestamptz, integer)` SECURITY DEFINER RPC on the existing `rate_limit_buckets` table; execute revoked from `anon`/`authenticated`, granted to `service_role`/`postgres`. Idempotent / rollback-inert. No new table.
- **`src/lib/rate-limit.ts`**: new `rateLimitCost()` + `pgCostBackend` (increment-by-N).
- **`src/lib/face-search-limits.ts`** (new): pure config (caps read from env), tier key builders, `AWS_CALLS_PER_FACE_SEARCH`, 50%-alert threshold helper.
- **`src/lib/email/send-face-search-alert.ts`** (new): Resend alert email.
- **`src/app/[lang]/events/[shareCode]/actions.ts`** (`searchFacesInEvent`): enforce tiers 2 & 3, fire the 50% alert, degrade gracefully; `face-search-shared.ts` gains an `unavailable` error discriminator.
- **`src/components/face-search-modal.tsx`** + `src/dictionaries/{en,es}.json`: new `errorUnavailable` copy.
- **`env.mjs`**: `FACE_SEARCH_GLOBAL_DAILY_CALLS`, `FACE_SEARCH_EVENT_DAILY_CALLS`, `FACE_SEARCH_ALERT_EMAIL` (optional).
- **`CLAUDE.md`**: update the AI-search "Rate limits" note + Environment Variables list.
