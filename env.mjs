// src/env.mjs
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  /*
   * Serverside Environment variables, not available on the client.
   * Will throw if you access these variables on the client.
   */
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']),
    // Optional: only needed if you explicitly use server-only keys
    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    SITE_URL: z.url(),
    STRIPE_PRICE_AMATEUR: z.string(),
    STRIPE_PRICE_PRO: z.string(),
    STRIPE_PRICE_AMATEUR_YEARLY: z.string(),
    STRIPE_PRICE_PRO_YEARLY: z.string(),
    RESEND_API_KEY: z.string().min(1),
    // AWS Rekognition (face indexing). Region defaults to eu-west-1 — staging
    // and prod both run there today. Credentials are required for the
    // Inngest worker to call AWS; in tests they're fake strings.
    AWS_REGION: z.string().default('eu-west-1'),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    // Prefix on every Rekognition collection id. Lets us namespace per env
    // (e.g. `photomarkt-staging-event-{uuid}` vs `-production-event-`).
    REKOGNITION_COLLECTION_PREFIX: z.string().default('photomarkt'),
    // Inngest credentials. EVENT_KEY signs outbound `inngest.send()` calls,
    // SIGNING_KEY verifies inbound webhook payloads to /api/inngest.
    INNGEST_EVENT_KEY: z.string().min(1),
    INNGEST_SIGNING_KEY: z.string().min(1),
    // Sentry error monitoring (optional). Without a DSN the SDK is a no-op, so
    // the app boots fine locally and in CI without these set. SENTRY_ORG/
    // SENTRY_PROJECT/SENTRY_AUTH_TOKEN are read directly by withSentryConfig at
    // build time and are not validated here.
    SENTRY_DSN: z.string().optional(),
    // Shared secret guarding GET /api/health/ready (T-044). Optional: when
    // unset the readiness endpoint stays locked (401), so absence is safe.
    HEALTH_CHECK_TOKEN: z.string().optional(),
    // Face-search abuse/cost caps (T-034). Configurable so we can raise them
    // the day a real event's athletes start searching, without a code deploy.
    // Defaults are deliberately low (global ~2000 AWS calls/day ≈ $2/day).
    FACE_SEARCH_GLOBAL_DAILY_CALLS: z.coerce.number().int().positive().default(2000),
    FACE_SEARCH_EVENT_DAILY_CALLS: z.coerce.number().int().positive().default(1000),
    // Recipient of the 50%-of-global-cap alert. Optional: absent ⇒ the alert
    // is a safe no-op (like SENTRY_DSN / HEALTH_CHECK_TOKEN).
    FACE_SEARCH_ALERT_EMAIL: z.email().optional(),
  },
  /*
   * Environment variables available on the client (and server).
   *
   * 💡 You'll get type errors if these are not prefixed with NEXT_PUBLIC_.
   */
  client: {
    // In dev this is often undefined, so make it optional
    NEXT_PUBLIC_VERCEL_URL: z.string().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    // Optional: if absent the LocationAutocomplete component falls back to mock suggestions
    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: z.string().optional(),
    // Optional Sentry browser DSN. Without it client-side error capture is a no-op.
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  /*
   * Due to how Next.js bundles environment variables on Edge and Client,
   * we need to manually destructure them to make sure all are included in bundle.
   *
   * 💡 You'll get type errors if not all variables from `server` & `client` are included here.
   */
  runtimeEnv: {
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    SITE_URL: process.env.SITE_URL,
    STRIPE_PRICE_AMATEUR: process.env.STRIPE_PRICE_AMATEUR,
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_AMATEUR_YEARLY: process.env.STRIPE_PRICE_AMATEUR_YEARLY,
    STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    REKOGNITION_COLLECTION_PREFIX: process.env.REKOGNITION_COLLECTION_PREFIX,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    HEALTH_CHECK_TOKEN: process.env.HEALTH_CHECK_TOKEN,
    FACE_SEARCH_GLOBAL_DAILY_CALLS: process.env.FACE_SEARCH_GLOBAL_DAILY_CALLS,
    FACE_SEARCH_EVENT_DAILY_CALLS: process.env.FACE_SEARCH_EVENT_DAILY_CALLS,
    FACE_SEARCH_ALERT_EMAIL: process.env.FACE_SEARCH_ALERT_EMAIL,
  },
});
