# Deployment & Production Go-Live

How Photo Markt is deployed, and the checklist to run before flipping the
production switch. The app runs on **Vercel** (Next.js App Router) with
**Supabase** (Postgres + Auth + Storage), **Stripe** (payments + Connect
payouts), **Resend** (email), **AWS Rekognition** (face indexing), and
**Inngest** (background jobs).

> Secrets live in **Vercel Project → Settings → Environment Variables** and in
> **GitHub → Settings → Secrets** (for the migration workflow). Never commit real
> keys — the values below are placeholders.

---

## 1. Environment variables

These are validated at boot by `env.mjs` (T3 Env / Zod). **A missing required
var fails the build/boot**, so set every one of them in Vercel for the
Production environment. Defaults noted where the schema provides one.

### Supabase
| Var | Notes |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (also used for `SUPABASE_URL` and image `remotePatterns`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — server only, bypasses RLS. Never expose to the client. |

### Stripe
| Var | Notes |
|-----|-------|
| `STRIPE_SECRET_KEY` | **Live** secret key (`sk_live_…`) for production. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the **live** webhook endpoint (see §3). |
| `STRIPE_PRICE_AMATEUR` | Starter monthly price ID (the `AMATEUR` key is the legacy name for the Starter tier). |
| `STRIPE_PRICE_PRO` | Pro monthly price ID. |
| `STRIPE_PRICE_AMATEUR_YEARLY` | Starter yearly price ID. |
| `STRIPE_PRICE_PRO_YEARLY` | Pro yearly price ID. |

### Email (Resend)
| Var | Notes |
|-----|-------|
| `RESEND_API_KEY` | Resend API key. Sender domain is currently hardcoded — see §4. |

### AWS Rekognition (face indexing)
| Var | Notes |
|-----|-------|
| `AWS_ACCESS_KEY_ID` | IAM credential for Rekognition. |
| `AWS_SECRET_ACCESS_KEY` | IAM secret. |
| `AWS_REGION` | Defaults to `eu-west-1` if unset. |
| `REKOGNITION_COLLECTION_PREFIX` | Defaults to `photomarkt`. Namespaces collections per env (e.g. `photomarkt-production-event-…`). Use a distinct prefix per environment. |

### Inngest (background worker)
| Var | Notes |
|-----|-------|
| `INNGEST_EVENT_KEY` | Signs outbound `inngest.send()` calls. Use the **production** Inngest app's key. |
| `INNGEST_SIGNING_KEY` | Verifies inbound webhooks at `/api/inngest`. |

### App
| Var | Notes |
|-----|-------|
| `SITE_URL` | Canonical production URL (e.g. `https://photomarkt.com`). Used for OG/canonical URLs and redirects. |
| `NEXT_PUBLIC_VERCEL_URL` | Optional; provided by Vercel. |

### Optional (feature-gated — app boots fine without them)
| Var | Effect when absent |
|-----|--------------------|
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Location autocomplete in event forms falls back to mock suggestions. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Server / browser error monitoring is a no-op (no events sent). |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Build-time only. Source maps upload to Sentry **only when `SENTRY_AUTH_TOKEN` is set**; token-less builds still succeed. |
| `BUYER_SERVICE_FEE_FIXED_CENTS` / `BUYER_SERVICE_FEE_BPS` | Buyer service fee (billing v2). Both default to **0**, which reproduces the pre-v2 behaviour exactly: no fee is charged, no fee line item is created, no fee is displayed. Setting them switches v2 on; setting them back to 0 is the rollback (no code revert). |
| `MIN_PHOTO_PRICE_CENTS` | Minimum price for a *priced* event, enforced when the price is written. Default **0** = no floor. Free events are always exempt. |

> **Not required:** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `PLATFORM_FEE_BPS`,
> `SUPABASE_JWT_SECRET`, and `RESEND_FROM_EMAIL` appear in some older docs but
> are **not referenced in code** — checkout uses server-side Stripe Checkout, so
> no publishable key is needed. Don't waste time provisioning them.

---

## 2. Database migrations

Migrations are raw SQL in `supabase/migrations/`. The
**`.github/workflows/migrate.yml`** workflow applies pending migrations against
the production database on every push to `main` that touches
`supabase/migrations/**` (and can be run manually via `workflow_dispatch`).

- The DB password is the GitHub secret **`SUPABASE_DB_PASSWORD_PROD`** — set it
  in GitHub repo secrets before the first deploy. The pooled connection host/ref
  is non-sensitive and inlined in the workflow.
- The workflow tracks applied versions in `supabase_migrations.schema_migrations`
  and skips already-applied files, so re-runs are safe (idempotent).
- **Go-live:** confirm the prod DB has every migration applied. Trigger the
  workflow manually once if the production project is new.

---

## 3. Stripe live-mode

Local/test setup is in the README (Stripe CLI for webhooks). For production:

1. Switch the Vercel env to **live** keys: `STRIPE_SECRET_KEY` = `sk_live_…`.
2. Create the live **products/prices** and set the four `STRIPE_PRICE_*` IDs to
   their live values.
3. Create a **live webhook endpoint** pointing at
   `https://<SITE_URL>/api/stripe/webhook`, subscribe to the events the handler
   needs (at minimum `payment_intent.succeeded` and the checkout/subscription
   events), and copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Stripe Connect:** ensure Connect is enabled on the live account —
   photographer payouts fire per order, synchronously, in the
   `payment_intent.succeeded` webhook (see `ARCHITECTURE.md` §4.3). Photo Markt
   absorbs the 0.5% Connect transfer fee.

---

## 4. Resend domain verification

The transactional sender is hardcoded as `Photo Markt <noreply@photomarkt.com>`
in `src/lib/email/send-guest-purchase-email.ts`. **Before go-live**, verify the
`photomarkt.com` domain in the Resend dashboard (add the SPF/DKIM DNS records).
Until the domain is verified, production emails will fail or land in spam.

---

## 5. Security headers & CSP

`next.config.ts` sets HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, and a `Permissions-Policy` (camera allowed for same-origin
selfie capture).

**There is no `Content-Security-Policy` yet.** Adding one is recommended
hardening but is deliberately deferred: a naive CSP would break inline JSON-LD
(`stringifyJsonLd`), Stripe, and the Sentry tunnel route (`/monitoring`). Do it
as a dedicated follow-up — add a nonce-based policy and verify JSON-LD, Stripe
Checkout, Google OAuth, image loading, and Sentry all still work before
enabling it in `report-only` first, then enforcing.

---

## 6. CI

`.github/workflows/test.yml` runs on every PR and on push to `main`: install →
boot local Supabase → `typecheck` → `lint` (Biome) → `test` (Vitest + coverage).
Coverage thresholds are reported but **not enforced** yet (see `vitest.config.ts`).
Keep PRs green before merging.

---

## 7. Post-deploy smoke test

After the production deploy, manually verify the critical paths:

- [ ] **Auth:** Google sign-in works and the OAuth callback redirects correctly.
- [ ] **Event creation:** a photographer can create an event and upload a photo.
- [ ] **Face indexing:** the uploaded photo's `face_index_status` reaches
      `indexed` (Inngest job ran) and selfie search returns it.
- [ ] **Purchase:** a talent can buy a photo end-to-end; the live Stripe webhook
      marks the order `completed`, clears the cart, and the full-res photo
      appears in orders.
- [ ] **Payout:** a Connect transfer is recorded for the photographer.
- [ ] **Email:** the purchase confirmation email is delivered (Resend domain
      verified, §4).
- [ ] **Monitoring:** if `SENTRY_DSN` is set, a deliberately-triggered error
      shows up in Sentry.
- [ ] **Consent/analytics:** the cookie banner appears; accepting loads Vercel
      Analytics, rejecting does not.

---

## Related work

These production-readiness items shipped as their own tickets/PRs:

- **T-021** — Terms of Service content (PR #78)
- **T-022** — Sentry error monitoring (PR #79)
- **T-023** — Vercel Web Analytics + Speed Insights (PR #80)
- **T-024** — Cookie consent banner gating analytics (PR #81)
- **T-025** — Health check endpoint `/api/health` (pending)
- **T-026** — This document
