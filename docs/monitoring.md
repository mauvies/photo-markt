# Monitoring (T-044)

Two layers, plus an external monitor that survives a full app outage.

## 1. Liveness — `GET /api/health`

No auth, no dependencies. Answers "is the app process serving requests?" (`{ "status": "ok" }`). Use it for a basic "is it up?" ping.

## 2. Readiness — `GET /api/health/ready`

Runs cheap, read-only probes against each external service in parallel (3s timeout each) and validates that credentials are valid:

```json
{
  "status": "ok",            // "ok" | "degraded" | "down"
  "environment": "production",
  "checks": [
    { "service": "supabase",        "status": "ok",      "latencyMs": 41 },
    { "service": "stripe",          "status": "ok",      "latencyMs": 120 },
    { "service": "aws-rekognition", "status": "ok",      "latencyMs": 90 },
    { "service": "resend",          "status": "ok",      "latencyMs": 80 },
    { "service": "inngest",         "status": "ok",      "latencyMs": 30 },
    { "service": "sentry",          "status": "ok",      "latencyMs": 0 },
    { "service": "money-alerts",    "status": "ok",      "latencyMs": 0 },
    { "service": "google-places",   "status": "skipped", "latencyMs": 0 }
  ]
}
```

- **Global `status`:** `down` if a **critical** probe (Supabase, Stripe, AWS Rekognition, Resend) is down; `degraded` if only a non-critical one (Inngest, money-alerts) is down; otherwise `ok`. The HTTP code is always `200` on a successful auth so the monitor can read the body — **alert on the `status` field, not the HTTP code**.
- **Per-service `status`:** `ok` | `down` | `skipped`. Caveats where a true connectivity check isn't possible: `inngest` reports `ok`/`skipped` by **key presence** (the worker route requires a signed request, so an unsigned health GET would 401 in cloud mode); `sentry` by DSN presence (no read API); `money-alerts` by whether **either** channel is live (see below); `google-places` is always `skipped` (the browser key is HTTP-referrer-restricted and can't be validated server-side).
- **`money-alerts` (T-266):** answers *"would a money incident still reach a human?"* — `reportMoneyIncident`
  has two optional channels (Sentry, `MONEY_ALERT_EMAIL`) and with **both** off every T-249 / T-253 / T-255
  alert collapses to a `console.error` nobody reads, silently. `ok` when either is configured, `down` when
  neither is **on the Vercel production deployment**, `skipped` everywhere else (dev, test and preview are
  *supposed* to run without ops alerting). It is deliberately **non-critical**: `degraded` already triggers
  the alert below, and reporting the site as `down` over unconfigured alerting is a false outage — the
  fastest way to teach whoever is on call to ignore this endpoint. Production is detected from
  `VERCEL_ENV`, never `NODE_ENV` (which is `'production'` on previews and in a local `pnpm build`).
  ⚠️ The channels stay optional in `env.mjs` on purpose: *an optional alert recipient must never be able to
  take the site down*. This check is the assertion that replaces that requirement — **if it reports `down`,
  no money alert is reaching anyone and that is a P0**, not a config nit.
- **Caching:** the probe sweep is cached for ~15s process-wide, so repeated monitor hits / dashboard reloads / a fail-open rate-limiter can't hammer the paid upstreams.
- **Security:** probe error detail is **never** returned (it can carry secrets) — only `service`/`status`/`latencyMs`. `Cache-Control: no-store`.

### Auth

Guarded by the `HEALTH_CHECK_TOKEN` env var. Until it's set the endpoint returns `401` (locked). Provide the token any of these ways:

- query: `GET /api/health/ready?token=<token>`
- header: `Authorization: Bearer <token>`
- header: `x-health-token: <token>`

Rate-limited to 20/hour per IP (it hits paid APIs).

Set a strong random `HEALTH_CHECK_TOKEN` (e.g. `openssl rand -hex 32`) in the env of **each** deployment (staging and production) — they can differ.

## 3. Internal dashboard — `/dashboard/admin/status`

Admin-only (gated on `admin_users`) page that runs the same probes and shows a green/red/grey light per service. Useful for a human glance; **not** a substitute for the external monitor (it goes down with the app).

## 4. External monitor (the important one)

A free uptime monitor (Better Stack, UptimeRobot, …) is what catches a full outage. Configure one monitor per environment:

| Setting | Value |
|---|---|
| URL (prod) | `https://<prod-domain>/api/health/ready` |
| URL (staging) | `https://<staging-domain>/api/health/ready` |
| Auth | header `x-health-token: <HEALTH_CHECK_TOKEN>` (or `?token=` if the tool can't send headers) |
| Interval | 1–5 min |
| Up condition | HTTP `200` **and** body keyword `"status":"ok"` |
| Alert | email / Slack on down or on keyword absence (`degraded`/`down`) |

Keep the interval ≥ the rate-limit headroom (20/h ⇒ ≥ ~3 min) so health pings don't exhaust the limiter.

> Heads-up: the readiness probes call **paid** APIs (Stripe/AWS/Resend) on every hit — they're free/cheap calls, but don't point a 10-second-interval monitor at it.
