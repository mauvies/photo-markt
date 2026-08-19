/**
 * Accepted Supabase security-advisor findings (T-225).
 *
 * Every `ERROR`/`WARN` finding the linter reports must appear here or CI fails.
 * One entry per finding, each with the reason it is acceptable — a baseline
 * without reasons is just a mute list and decays into "we always ignored that".
 *
 * `INFO` findings do not fail the build; the ones listed below are here so the
 * reasoning is written down (and so the gate does not go red if Supabase raises
 * their level later).
 *
 * TO ACCEPT A NEW FINDING: add its key with a reason. TO SEE THE KEYS: run
 * `pnpm advisors:check` — the failure prints them.
 */

import type { AdvisorBaseline } from './supabase-advisors';

export const ADVISORS_BASELINE: AdvisorBaseline = {
  /**
   * STAGING. See the header of `check-supabase-advisors.ts`: a Supabase PAT is
   * account-wide, so this pinned ref — not the credential — is what keeps the
   * job off production.
   */
  projectRef: 'rozglsxdolgouslaojtm',

  accepted: [
    // ── rls_enabled_no_policy (INFO) ──────────────────────────────────────────
    // RLS enabled with zero policies is TOTAL DENIAL for anon/authenticated, which
    // is the documented pattern for tables with no public access path: reads and
    // writes go through `supabaseAdmin` (service role bypasses RLS). The linter
    // cannot tell that shape apart from "somebody forgot the policies", so each
    // one is named individually rather than silencing the rule.
    {
      key: 'rls_enabled_no_policy:public.admin_users',
      level: 'INFO',
      reason:
        'Service-role only by design — the admin service-status page gates on it via supabaseAdmin.',
    },
    {
      key: 'rls_enabled_no_policy:public.rate_limit_buckets',
      level: 'INFO',
      reason:
        'Service-role only by design — written solely by the increment_* SECURITY DEFINER RPCs.',
    },
    {
      key: 'rls_enabled_no_policy:public.subscriptions',
      level: 'INFO',
      reason: 'Written by the Stripe webhook only; the dashboard reads it server-side.',
    },
    {
      key: 'rls_enabled_no_policy:public.guest_orders',
      level: 'INFO',
      reason:
        'Guest purchases have no auth user to scope a policy to — access is the download token.',
    },
    {
      key: 'rls_enabled_no_policy:public.guest_order_items',
      level: 'INFO',
      reason: 'Same as guest_orders — service-role reads behind the signed download token.',
    },
    {
      key: 'rls_enabled_no_policy:public.pending_guest_checkouts',
      level: 'INFO',
      reason: 'Pre-payment scratch rows, read only by the Stripe webhook.',
    },
    {
      key: 'rls_enabled_no_policy:public.photos_orphan_storage_pending_cleanup',
      level: 'INFO',
      reason: 'Internal queue for the storage-cleanup cron; no user-facing read path.',
    },

    // ── function_search_path_mutable (WARN) ───────────────────────────────────
    // A mutable search_path is a privilege-escalation vector only when the
    // function runs with privileges the caller lacks. All of these are SECURITY
    // INVOKER trigger functions except `order_has_photographer_items` — an
    // attacker who could bend their search_path would only be running as
    // themselves. Pinning `search_path` means schema-qualifying every reference
    // inside each body, i.e. a DDL migration applied by hand to prod
    // (migrate.yml is red on Actions billing); tracked, not done here, because
    // this ticket ships the linter rather than schema changes.
    ...(
      [
        'set_profiles_updated_at',
        'set_profile_slug_on_insert',
        'set_orders_updated_at',
        'set_orders_completed_at',
        'set_carts_updated_at',
        'set_subscriptions_updated_at',
        'set_payouts_updated_at',
        'set_payouts_paid_at',
        'set_payment_accounts_updated_at',
        'set_ai_search_profiles_updated_at',
        'set_photo_embeddings_updated_at',
      ] as const
    ).map((fn) => ({
      key: `function_search_path_mutable:public.${fn}`,
      level: 'WARN',
      reason:
        'SECURITY INVOKER trigger function — no privileges to escalate to. Pinning search_path deferred.',
    })),
    {
      key: 'function_search_path_mutable:public.order_has_photographer_items',
      level: 'WARN',
      reason:
        'The one that actually matters here (SECURITY DEFINER). Deferred with the rest of that function — see 20260803000000.',
    },

    // ── extension_in_public (WARN) ────────────────────────────────────────────
    {
      key: 'extension_in_public:public.unaccent',
      level: 'WARN',
      reason:
        'Relocating an in-use extension rewrites every dependent object; no injection path today.',
    },
    {
      key: 'extension_in_public:public.vector',
      level: 'WARN',
      reason:
        'Left over from the removed pgvector matching path (20260518000000); drop it with the dead schema in T-219.',
    },

    // ── SECURITY DEFINER exposure (WARN) ──────────────────────────────────────
    // The post-incident state after PR #279 / #281. What the linter reports as a
    // warning is now the deliberate configuration, and each function's exposure
    // is separately pinned by test/integration/security/security-definer-rpcs.ts.
    {
      key: 'anon_security_definer_function_executable:public.order_has_photographer_items(order_id uuid, photographer_id uuid)',
      level: 'WARN',
      reason:
        'Helper of the `orders` RLS policy: revoking EXECUTE turns an anon SELECT into "permission denied". Leak is a boolean oracle behind two unguessable UUIDs — see 20260803000000.',
    },
    {
      key: 'authenticated_security_definer_function_executable:public.order_has_photographer_items(order_id uuid, photographer_id uuid)',
      level: 'WARN',
      reason: 'Same RLS policy helper — photographers reading their own orders need it.',
    },
    {
      key: 'authenticated_security_definer_function_executable:public.search_users_by_text(search_text text, result_limit integer)',
      level: 'WARN',
      reason:
        'Tag-talent search. Anon revoked in 20260803000000 and the function bounded in 20260804000000 (3-char floor, escaped LIKE, capped limit, no email column, exact-match email).',
    },
    {
      key: 'authenticated_security_definer_function_executable:public.search_user_by_email(search_email text)',
      level: 'WARN',
      reason:
        'Delegates to search_users_by_text and inherits its bounds; zero callers, dropped in T-219.',
    },
    {
      key: 'authenticated_security_definer_function_executable:public.get_user_emails_batch(user_ids uuid[])',
      level: 'WARN',
      reason:
        'Resolves buyer emails for the photographer sales tab from ids already known server-side — the preferred shape over exposing email to a text search.',
    },

    // ── auth (WARN) ───────────────────────────────────────────────────────────
    {
      key: 'auth_leaked_password_protection',
      level: 'WARN',
      reason: 'Not applicable — the app is Google-OAuth-only, no password is ever set.',
    },
  ],
};
