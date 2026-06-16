## Why

New users never see the role/username onboarding step on the primary auth paths. After Google OAuth (the documented method) or email confirmation, `/auth/callback` routes a roleless user to `/dashboard` — not `/onboarding/role` like the login page does. The bare `/dashboard` page then calls `getActiveRole()`, which is a **read with a write side effect**: finding no profile, it falls back to `PHOTOGRAPHER` and persists a profile with an email-derived username via `generateUsernameFromEmail`. From that moment `profiles.active_role` is non-null, so onboarding is skipped forever and the user is silently stamped `PHOTOGRAPHER` with a machine-generated username.

This also means the `allow-user-set-username` change fixes a code path (`completeOnboarding`) that real OAuth/email-confirm users never reach — the username feature is effectively dead until this bypass is fixed.

## What Changes

- **Fix routing inconsistency**: `/auth/callback` SHALL route an authenticated user with no chosen role to `/onboarding/role`, mirroring the login page — instead of sending them to `/dashboard`.
- **Make role resolution side-effect-free**: `getActiveRole()` (and `getDashboardPath()`, which wraps it) SHALL NOT create a profile. Resolving a role for display/routing becomes a pure read; profile creation moves to the explicit onboarding/role-switch write paths only. This makes "no profile row" a stable, representable state meaning *"authenticated but not yet onboarded"*.
- **Guarantee the gate holds across entry points**: any authenticated user without a completed onboarding who lands on a dashboard route SHALL be redirected to `/onboarding/role` rather than have a default profile minted for them.
- **No data backfill**: existing users (who already have profiles, possibly with email-derived usernames) are unaffected; only the new-user write path changes.

## Capabilities

### New Capabilities
- `onboarding-routing`: Routing and gating that guarantees a newly authenticated user without a chosen role reaches the role/username onboarding step before any dashboard route mints a default profile. Covers the `/auth/callback` destination, the side-effect-free contract of role resolution, and the dashboard-entry gate.

### Modified Capabilities
<!-- None: there are no existing OpenSpec specs under openspec/specs/ to amend. The persistence/validation/i18n behavior of the onboarding step itself is owned by the in-flight `allow-user-set-username` change and is not modified here. -->

## Impact

- **Code (auth)**: `app/auth/callback/route.ts` — change the no-role fallback destination from `/dashboard` to `/onboarding/role`.
- **Code (actions)**: `app/[lang]/actions/roles.ts` — `getActiveRole`/`getDashboardPath` stop persisting a fallback profile; introduce a pure "resolve role or null" read and keep writes in `completeOnboarding` / `switchRole` / `enableTalentRole`.
- **Code (dashboard entry)**: `app/[lang]/dashboard/page.tsx` and `app/[lang]/dashboard/{photographer,talent}/layout.tsx` — handle the "no role yet" case by redirecting to onboarding instead of relying on the old profile-minting side effect.
- **Tests**: `test/integration/` — regression that a roleless user is routed to onboarding and that resolving a role does not create a profile; the `allow-user-set-username` suite stays green.
- **Database**: none — `active_role` stays `NOT NULL DEFAULT 'PHOTOGRAPHER'`; the fix is application-layer (no migration).
- **Dependency**: complements `allow-user-set-username` — that change makes `completeOnboarding` persist the chosen username correctly; this change makes `completeOnboarding` actually reachable. No breaking changes for existing users.
