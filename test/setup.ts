/**
 * Vitest global setup — runs before every test file.
 *
 * Provides default values for env vars that `env.mjs` validates at import
 * time. Without this, importing anything that transitively touches
 * `env.mjs` (every API route, every Server Action) would throw at module
 * load. Real values from `.env.local` win when present (locally); CI runs
 * with the fakes below.
 *
 * **None of these values are secrets.** The Supabase keys are the
 * documented local-CLI defaults; the Stripe keys are obvious fakes that
 * the SDK accepts as well-formed but rejects on real API calls (which the
 * webhook tests mock anyway).
 */

const TEST_ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  SUPABASE_SERVICE_ROLE_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  STRIPE_SECRET_KEY: 'sk_test_dummy_for_tests',
  // The Stripe webhook tests sign payloads with this exact value. Keep them
  // in sync if you change it.
  STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy_for_tests_at_least_32_chars',
  STRIPE_PRICE_AMATEUR: 'price_test_amateur',
  STRIPE_PRICE_PRO: 'price_test_pro',
  STRIPE_PRICE_AMATEUR_YEARLY: 'price_test_amateur_yearly',
  STRIPE_PRICE_PRO_YEARLY: 'price_test_pro_yearly',
  RESEND_API_KEY: 're_test_dummy',
  SITE_URL: 'http://127.0.0.1:3000',
  // AWS Rekognition credentials — fake values; tests never hit AWS.
  AWS_REGION: 'eu-west-1',
  AWS_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKEFAKE',
  AWS_SECRET_ACCESS_KEY: 'fake-aws-secret-key-for-tests-only',
  REKOGNITION_COLLECTION_PREFIX: 'photomarkt',
  // Inngest credentials — fake values; tests don't hit Inngest, server-action
  // tests mock `inngest.send()` when they care about emissions.
  INNGEST_EVENT_KEY: 'inngest-event-key-fake-for-tests',
  INNGEST_SIGNING_KEY: 'signkey-test-fake-for-tests',
  // Readiness-endpoint token (T-044) — tests use this exact value.
  HEALTH_CHECK_TOKEN: 'health-token-fake-for-tests',
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
