## 1. Side-effect-free role resolution (Defect B)

- [x] 1.1 In `app/[lang]/actions/roles.ts`, add a pure resolver `getActiveRoleOrNull()` that returns the stored `active_role` (as a slug) or `null` when the user has no profile — reading via `getProfileActiveRole`, performing NO upsert and NO `generateUsernameFromEmail`.
- [x] 1.2 Remove the profile-creating fallback from `getActiveRole()`/`getDashboardPath()` so resolving a role never calls `upsertProfileRole`. Decide the contract: either make `getDashboardPath()` return `null`/throw-to-redirect for roleless users, or have callers use `getActiveRoleOrNull()` directly.
- [x] 1.3 Audit every caller of `getActiveRole`/`getDashboardPath` (`grep -rn "getActiveRole\|getDashboardPath" app/`) and confirm each routing/display caller handles the "no role yet" case explicitly. Confirm the only profile-creating paths remaining are `completeOnboarding`, `switchRole`, and `enableTalentRole`.

## 2. Route roleless users to onboarding (Defect A)

- [x] 2.1 In `app/auth/callback/route.ts`, change the final no-role fallback from `/dashboard` to `/onboarding/role`, leaving the `plan`/`token`/`next` branches unchanged. Use the pure resolver for the role check so the callback never mints a profile.
- [x] 2.2 Verify the login page (`app/[lang]/login/page.tsx`) already routes roleless users to `/onboarding/role` on both the page-load guard and the `signIn` action, and that it uses the pure resolver (no side-effect create).

## 3. Dashboard entry gate (belt-and-suspenders)

- [x] 3.1 In `app/[lang]/dashboard/page.tsx`, resolve via `getActiveRoleOrNull()`; when `null`, `localizedRedirect(lang, '/onboarding/role')` instead of defaulting to the photographer dashboard.
- [x] 3.2 In `app/[lang]/dashboard/photographer/layout.tsx` and `app/[lang]/dashboard/talent/layout.tsx`, handle the `null` (not-onboarded) case by redirecting to `/onboarding/role` rather than relying on a minted profile.

## 4. Tests

- [x] 4.1 Integration regression (must FAIL before the fix, PASS after): resolving the active role for a user with no profile does NOT create a profile and does NOT generate an email-derived username.
- [~] 4.2 Integration test: the callback/login routing helper sends a roleless authenticated user to `/onboarding/role` (and an onboarded user to their dashboard). _(Partial: the decision is `getActiveRoleOrNull() === null`, tested directly in `onboarding-routing.test.ts` (null for roleless, role for onboarded). The OAuth `/auth/callback` handler needs a real `exchangeCodeForSession` code the harness can't fabricate, so the redirect target itself is covered by typecheck + manual e2e (5.2) rather than a route-handler test.)_
- [~] 4.3 Integration test: a dashboard entry point with a roleless user redirects to `/onboarding/role` and creates no default profile. _(Partial: "creates no default profile" is the core regression and is tested (`getActiveRole`/`getActiveRoleOrNull` write nothing for a roleless user). The page/layout `null → localizedRedirect('/onboarding/role')` branch is a thin wrapper over that resolver result, covered by typecheck; RSC-render tests not added.)_
- [x] 4.4 End-to-end-ish test: a brand-new user routed through onboarding and completing it with a chosen username persists that username + role (not email-derived); confirm the `allow-user-set-username` suite still passes.

## 5. Verification

- [x] 5.1 `pnpm typecheck` clean, `pnpm lint` clean, `pnpm test` green (pre-existing unrelated failures noted).
- [ ] 5.2 Manual: register a fresh account via Google on staging → lands on `/onboarding/role`, choose role + username, confirm persisted profile matches the choice and `/photographer/<username>` resolves for photographers. _(Not runnable headless — requires interactive Google OAuth. Left for a human; note staging currently has "Confirm email" on and the built-in email rate limit, so use Google rather than email/password.)_

## 6. Cross-change note

- [x] 6.1 Add a one-line dependency note to `openspec/changes/allow-user-set-username/proposal.md` (or design.md) recording that its `completeOnboarding` fix is only reachable once this bypass change lands. No application-code change.
