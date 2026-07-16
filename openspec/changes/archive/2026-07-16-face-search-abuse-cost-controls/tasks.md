## 1. Database

- [x] 1.1 Add migration `..._add_increment_rate_limit_bucket_by.sql`: `increment_rate_limit_bucket_by(p_bucket_key text, p_window_start timestamptz, p_amount integer) returns integer`, SECURITY DEFINER, `set search_path = public`, single-statement upsert `+ p_amount RETURNING count`. Idempotent (`create or replace`).
- [x] 1.2 `revoke all ... from public`; `grant execute ... to service_role, postgres`; `revoke execute ... from anon, authenticated`. Add table/function comments.

## 2. Config + limiter lib

- [x] 2.1 `src/lib/face-search-limits.ts` (pure): `AWS_CALLS_PER_FACE_SEARCH = 1` (documented), `getFaceSearchLimits()` reading env caps with defaults, key builders (`eventDailyKey`, `globalDailyKey`, `alertClaimKey`), `shouldAlertAtFiftyPercent(count, cap)`.
- [x] 2.2 `src/lib/rate-limit.ts`: add `RateLimitCostBackend`, `pgCostBackend` (calls `increment_rate_limit_bucket_by`), and `rateLimitCost({ key, limit, windowSec, cost }, backend?)` reusing `computeWindow`/`evaluate` + the fail-open path.
- [x] 2.3 `env.mjs`: add `FACE_SEARCH_GLOBAL_DAILY_CALLS` (coerce int, default 2000), `FACE_SEARCH_EVENT_DAILY_CALLS` (default 1000), `FACE_SEARCH_ALERT_EMAIL` (email, optional) to `server` + `runtimeEnv`.

## 3. Alert email

- [x] 3.1 `src/lib/email/send-face-search-alert.ts` (Resend): plain email reporting current usage vs cap; FROM = existing `noreply@photomarkt.com`.

## 4. Enforcement

- [x] 4.1 In `searchFacesInEvent`: after selfie validation + image prep, add tier-2 (per-event/day) then tier-3 (global/day) `rateLimitCost` checks incrementing by `AWS_CALLS_PER_FACE_SEARCH`, before the AWS call; key tier 1 + tier 2/3 on the resolved `event.id`.
- [x] 4.2 On breaker trip: throw `RATE_LIMIT:face-search:unavailable`; log which tier tripped (no PII).
- [x] 4.3 After the global increment, when `shouldAlertAtFiftyPercent`, atomically claim `alertClaimKey(window)` via the increment-by-1 RPC; on first claim send the alert (best-effort, no-op when no recipient).

## 5. Client degradation + i18n

- [x] 5.1 `face-search-shared.ts`: add `FACE_SEARCH_UNAVAILABLE` discriminator + `isFaceSearchUnavailableError`; keep `isFaceSearchRateLimitError` matching only `:exhausted`.
- [x] 5.2 `face-search-modal.tsx`: add `errorUnavailable` to `FaceSearchModalLabels`; in `submit` catch, check unavailable → rate-limit → generic.
- [x] 5.3 Add `aiSearch.modal.errorUnavailable` to `src/dictionaries/en.json` and `es.json`.

## 6. Tests

- [x] 6.1 Unit (`test/unit/lib/face-search-limits.test.ts`): config defaults/overrides, key builders, `shouldAlertAtFiftyPercent`, `AWS_CALLS_PER_FACE_SEARCH`.
- [x] 6.2 Unit (`test/unit/lib/rate-limit.test.ts`): `rateLimitCost` increments by `cost`, blocks over limit, concurrent burst monotonic (injected backend).
- [x] 6.3 Integration (`test/integration/actions/face-search.test.ts`): global breaker → `:unavailable` + AWS not called; per-event breaker isolates one event; successful search increments both daily counters by `AWS_CALLS_PER_FACE_SEARCH`; window reset (prior-day cap doesn't block today); 50% alert fires once (mock Resend module); bib search still works when the face breaker is open.

## 7. Docs + release

- [x] 7.1 Update `CLAUDE.md`: AI-search "Rate limits" note (tiered caps + breaker + 50% alert, per-`(event, IP)`/hour is Postgres/atomic) + Environment Variables list.
- [x] 7.2 `pnpm typecheck && pnpm lint && pnpm test` green; `/code-review` (security/DB/cost) on the diff; fix real findings.
