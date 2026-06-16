## Context

New users never see the onboarding role/username step on the OAuth and email-confirmation paths. Two defects compound:

**Defect A — routing inconsistency.** The login page (`app/[lang]/login/page.tsx`) sends a roleless user to `/onboarding/role`, but `app/auth/callback/route.ts` sends the equivalent user to `/dashboard`. Google OAuth (the documented auth method) and email confirmation both go through the callback, so they bypass onboarding.

**Defect B — role resolution has a write side effect.** `getActiveRole()` in `app/[lang]/actions/roles.ts` is used for routing/display, but when no profile exists it falls back to `PHOTOGRAPHER` and calls `upsertProfileRole(...)`, which generates a username from the email and **persists a profile**. The bare `/dashboard` page and the `/dashboard/{photographer,talent}` layouts all call `getActiveRole()`, so the first dashboard hit mints a default profile.

Because `profiles.active_role` is `NOT NULL DEFAULT 'PHOTOGRAPHER'`, the existence of a profile row is equivalent to "has a role." Once Defect B writes that row, `getProfileActiveRole` returns non-null forever and onboarding is permanently skipped. Verified on staging: a user created at 13:46:16 had a profile at 13:46:18 with `username = mauricio_viera_sotillo` (email-derived) and `active_role = PHOTOGRAPHER`; there is no `auth.users` trigger that creates profiles, so the write came from app code.

This change is the routing/lifecycle counterpart to the in-flight `allow-user-set-username` change: that one makes `completeOnboarding` persist the chosen username correctly; this one makes `completeOnboarding` actually reachable.

## Goals / Non-Goals

**Goals:**
- A roleless authenticated user reaches `/onboarding/role` on every primary entry path (OAuth callback, email-confirm callback, password login).
- Resolving the current role for routing/display never creates or mutates a profile.
- "No profile row" becomes a stable state meaning "authenticated but not yet onboarded."
- Dashboard routes redirect roleless users to onboarding instead of minting a default profile.

**Non-Goals:**
- No database migration; `active_role` stays `NOT NULL DEFAULT 'PHOTOGRAPHER'`.
- No backfill or change to existing users (their profiles already exist).
- No change to the onboarding step's own persistence/validation/i18n (owned by `allow-user-set-username`).
- No change to the OAuth provider set, the Stripe `plan`/`token`/`next` redirect branches, or `display_name` handling.

## Decisions

### D1: Callback no-role fallback redirects to `/onboarding/role`
Change the final fallback in `app/auth/callback/route.ts` from `/dashboard` to `/onboarding/role`, matching the login page. The `plan`, `token`, and `next` branches above it are unchanged — only the "authenticated, no role, no special redirect" case moves.
- **Alternative (rejected):** keep `/dashboard` and let a gate elsewhere catch it. Rejected: relies on Defect B's side effect not firing first, which is exactly the bug.

### D2: Split role resolution into a pure read and an explicit create
Introduce a side-effect-free resolver — `getActiveRoleOrNull()` (pure read: returns the stored role or `null`/"not onboarded") — and stop `getActiveRole()`/`getDashboardPath()` from calling `upsertProfileRole` on the no-profile path. Profile creation stays only in `completeOnboarding`, `switchRole`, and `enableTalentRole`.
- Routing/gating code consumes the pure resolver and treats `null` as "send to onboarding."
- **Alternative (rejected):** keep the side effect but guard it behind a flag. Rejected: a getter that writes is the root smell; removing the write makes "no profile = not onboarded" reliable everywhere at once.

### D3: Dashboard entry points gate on the pure resolver
`app/[lang]/dashboard/page.tsx` and `app/[lang]/dashboard/{photographer,talent}/layout.tsx` resolve the role via the pure read; when it is `null`, they `localizedRedirect(lang, '/onboarding/role')` instead of defaulting. This is the belt-and-suspenders gate so a direct deep-link to a dashboard can't bypass onboarding.
- **Alternative (considered, deferred):** a single gate in `proxy.ts` middleware (Option D from exploration). Cleaner centralization, but middleware runs on every request and would need to read the profile/role cheaply; deferred to an open question rather than adopted now to keep blast radius small.

### D4: Treat "profile exists" as the onboarding signal, no schema change
We keep `active_role NOT NULL DEFAULT`. The onboarding gate already uses `getProfileActiveRole` (a pure read that returns `null` when no row exists). Once D2 stops minting rows, that null reliably means "not onboarded" — so no `onboarding_completed` column or nullable `active_role` is needed.
- **Alternative (rejected for now):** add an explicit `onboarding_completed` boolean. More expressive but requires a migration and backfill; unnecessary once the side effect is gone.

## Risks / Trade-offs

- **[Other callers of `getActiveRole` rely on the auto-create]** → Audit every caller (`grep getActiveRole|getDashboardPath`); each routing/display caller must handle the `null`/"not onboarded" case explicitly. The only legitimate profile-creating callers are the onboarding/role-switch actions.
- **[A roleless user loops if onboarding can't complete]** → Onboarding completion (`completeOnboarding`) writes the profile, flipping the gate; ensure the onboarding page itself never calls the pure resolver in a way that redirects back (it already uses `getProfileActiveRole` directly).
- **[Existing users with email-derived usernames stay as-is]** → Acceptable and intended (Non-Goal); only new-user writes change. They can edit the username in photographer settings.
- **[Deep links / `next` redirects into dashboards]** → The D3 gate covers direct navigation; `next` redirects in callback/login already run before the gate and target authenticated surfaces, so a roleless user following `next` into a dashboard is still caught by D3.
- **[Race: parallel dashboard layout + page resolution]** → With the side effect removed, parallel reads are harmless (no writes to race); the worst case is two redirects to onboarding.

## Migration Plan

1. No DB migration. Standard app deploy.
2. Order: D2 (remove side effect + add pure resolver) first, then D1 (callback) and D3 (dashboard gates) which depend on the pure resolver, then tests.
3. **Rollback:** revert the branch. Existing users are unaffected; the only behavioral change is that brand-new roleless users are sent to onboarding instead of being auto-stamped.
4. Post-deploy check: register a fresh account via Google on staging → confirm landing on `/onboarding/role`, choose role+username, confirm the persisted profile matches the choice (not email-derived).

## Open Questions

- Adopt the centralized `proxy.ts` middleware gate (Option D) instead of/in addition to the per-route D3 gates? Decision deferred; per-route gating is sufficient for correctness.
- Should existing users with email-derived usernames get a one-time prompt to pick a real username, or is the photographer-settings editor enough? Out of scope here; flag for product.
- Does any non-dashboard authenticated surface also call `getActiveRole`/`getDashboardPath` and need the same null-handling? Resolve during the caller audit in D2.
