## 1. Shared validation helper

- [x] 1.1 Create `lib/username.ts` exporting pure `normalizeUsername(raw: string): string` (lowercase + strip `[^a-z0-9_-]`) and `isValidUsername(value: string): boolean` (3–30 chars + `^[a-z0-9_-]+$`).
- [x] 1.2 Add unit tests `test/unit/lib/username.test.ts` covering normalization (mixed case, spaces, punctuation), length bounds, and regex edge cases.

## 2. Fix username persistence (core bug)

- [x] 2.1 In `database/queries/profiles.ts`, allow an explicit username to be persisted with the role: add optional `username` to `upsertProfileRole` (or add `upsertProfileRoleWithUsername`) that upserts `{ id, active_role, username, slug: username }` and only falls back to `generateUsernameFromEmail` when no username is supplied and none exists.
- [x] 2.2 In `app/[lang]/actions/roles.ts`, rewrite `completeOnboarding(role, username)` to normalize the username, run the uniqueness check (`select id where username = X and id != me`), then persist role + username + slug via the query from 2.1 in one upsert. Remove the broken `updateProfile({ username })`-then-`upsertProfileRole` sequence.
- [x] 2.3 Map a residual unique-constraint violation (TOCTOU race) to the same friendly "taken" outcome instead of letting it throw (defense-in-depth).

## 3. Onboarding action validation + error surfacing

- [x] 3.1 In `app/[lang]/onboarding/role/page.tsx` `saveRole`, use `normalizeUsername`/`isValidUsername`; redirect with localized `message` codes (`invalid_role`, `username_invalid`, `username_taken`).
- [x] 3.2 In the page server component, read `searchParams.message`, map it to a localized string, and pass it into `OnboardingRoleForm`.

## 4. i18n

- [x] 4.1 Add `onboarding.*` keys to `dictionaries/en.json`: role card titles + descriptions, `usernameLabel`, `usernameHelp`, `usernamePlaceholder`, `usernameTooShort`, `usernameTaken`, `usernameInvalid`, `continue`, and availability states (`checking`, `available`, `unavailable`).
- [x] 4.2 Add the same keys with Spanish translations to `dictionaries/es.json` (verify key sets match exactly between the two files).
- [x] 4.3 Update `components/onboarding-role-form.tsx` to receive the dictionary slice as a prop and render all text from it — remove every hardcoded English string. Render the error message passed from the page.

## 5. Real-time availability (enhancement)

- [x] 5.1 Add `checkUsernameAvailability(candidate: string)` server action returning `{ available: boolean, reason?: 'invalid' | 'taken' }`, reusing `lib/username.ts` and treating the current user's own username as available.
- [x] 5.2 Wire a debounced (~400ms) availability check into `OnboardingRoleForm` with checking/available/taken UI states using the new i18n keys.

## 6. Slug for photographers

- [x] 6.1 Confirm (and test) that completing onboarding as `photographer` results in `slug === username` and that `/photographer/<username>` resolves.

## 7. Tests

- [x] 7.1 Integration regression test (must FAIL before task 2 fix, PASS after): new user with no profile completes onboarding with a chosen username → `profiles.username` equals the chosen value (not email-derived).
- [x] 7.2 Integration test: submitting a username already owned by another user does not complete onboarding and surfaces the "taken" outcome (no unhandled DB error).
- [x] 7.3 Integration test: invalid/short username is rejected; user keeps own username (self-collision passes).
- [x] 7.4 Integration test: photographer onboarding sets `slug = username`.
- [x] 7.5 Integration test for `checkUsernameAvailability`: free → available, taken → unavailable, own → available.

## 8. Verification

- [x] 8.1 `pnpm typecheck` clean, `pnpm lint` clean, `pnpm test` green.
- [ ] 8.2 Manual end-to-end: fresh account in `es` and `en`, confirm chosen username + slug persist, error messages render localized, availability check works. _(Not runnable headless — onboarding is gated behind Google OAuth. All four behaviors are covered by automated tests: persistence/normalization/uniqueness/self-collision/slug in `test/integration/actions/onboarding-username.test.ts`, localized strings via the dict-driven form + matching `onboarding.*` keys in both dictionaries, availability via `checkUsernameAvailability` tests. Left for a human to click through against the cloud DB, which has the `slug` column.)_

## 9. Multi-agent workflow harness (deliverable)

- [x] 9.1 Author `openspec/changes/allow-user-set-username/workflow.mjs`: Implement phase (parallel agents per workstream from groups 1–7), Verify phase (loop-until-clean: typecheck/lint/test + adversarial agent that tries to reproduce the discarded-username regression), Synthesize phase (diff summary + tasks.md checklist audit).
- [x] 9.2 Document how to run it (explicit opt-in, e.g. "ultracode" / "use a workflow") and confirm `meta.phases` titles match the `phase()` calls.

## 10. Suggested default username (added enhancement)

- [x] 10.1 In `database/queries/profiles.ts`, extract the uniqueness loop into `ensureUniqueUsername(supabase, base)` (min-length, 30-cap, append `_N` until free) and refactor `generateUsernameFromEmail` to reuse it. Add `getSuggestedUsername(supabase, { fullName, email })` that derives a base from the normalized display name (fallback to email local-part) and returns an available username via `ensureUniqueUsername`.
- [x] 10.2 In `app/[lang]/onboarding/role/page.tsx`, compute the suggestion from `user.user_metadata` (full_name/name) and `user.email`, and pass it to `OnboardingRoleForm` as a `suggestedUsername` prop.
- [x] 10.3 In `components/onboarding-role-form.tsx`, initialize the username state from `suggestedUsername` so the field appears pre-filled; keep it fully editable and let the existing debounced availability check run on the suggestion.
- [x] 10.4 Integration test for `getSuggestedUsername`: name-based suggestion, email fallback when no name, and numeric-suffix when the base is taken. Confirm the suggested value passes `isValidUsername` and is available.
