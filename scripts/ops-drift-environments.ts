/**
 * The environments `pnpm ops:drift` checks, and where each one lives (T-256).
 *
 * ⚠️ **Pinned here on purpose, exactly like `advisors-baseline.ts`.** A Supabase
 * PAT is account-wide and a Stripe key carries its own mode, so no credential can
 * enforce "this run is looking at staging". The versioned ref is the control, and
 * changing it shows up in a diff. Do not move these into repository variables.
 *
 * ⚠️ **Credentials are named per environment and never fall back to each other.**
 * A fallback is how a run reads the local test-mode Stripe key while claiming to
 * report on production — a green tick for something nobody checked, which is
 * worse than the red the whole script exists to print. A credential that is not
 * set makes its check SKIP, loudly.
 */

export interface OpsEnvironment {
  name: string;
  /** Supabase project ref — see the warning above before changing one. */
  supabaseRef: string;
  /**
   * Where the deployment answers, for the Inngest introspection.
   *
   * ⚠️ Production is the `www` host, not the apex: the apex 307-redirects, which
   * is what killed every Stripe delivery until 2026-07-28 (T-192).
   */
  siteUrl?: string;
  /** Overrides `siteUrl` when set — staging has no stable host. */
  siteUrlVar: string;
  inngestSigningKeyVar: string;
  stripeSecretKeyVar: string;
  /** The key mode this environment must use; a mismatch is a hard error. */
  stripeKeyPrefix: 'sk_test_' | 'sk_live_';
}

export const OPS_ENVIRONMENTS: OpsEnvironment[] = [
  {
    name: 'staging',
    supabaseRef: 'rozglsxdolgouslaojtm',
    siteUrlVar: 'OPS_DRIFT_STAGING_SITE_URL',
    inngestSigningKeyVar: 'OPS_DRIFT_STAGING_INNGEST_SIGNING_KEY',
    stripeSecretKeyVar: 'OPS_DRIFT_STAGING_STRIPE_SECRET_KEY',
    stripeKeyPrefix: 'sk_test_',
  },
  {
    name: 'production',
    supabaseRef: 'yzdlueeeizdqwuicydbr',
    siteUrl: 'https://www.photomarkt.com',
    siteUrlVar: 'OPS_DRIFT_PRODUCTION_SITE_URL',
    inngestSigningKeyVar: 'OPS_DRIFT_PRODUCTION_INNGEST_SIGNING_KEY',
    stripeSecretKeyVar: 'OPS_DRIFT_PRODUCTION_STRIPE_SECRET_KEY',
    stripeKeyPrefix: 'sk_live_',
  },
];
