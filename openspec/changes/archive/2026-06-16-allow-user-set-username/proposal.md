## Why

We want users to choose their own `username` during sign-up, at the same step where they pick a role. Investigation showed the role step **already renders a username field**, but the feature is **broken and incomplete** on the primary path:

- **Chosen username is silently discarded for new users.** In `completeOnboarding`, `updateProfile({ username })` runs an `UPDATE ... WHERE id = userId`, which matches **zero rows** when the profile doesn't exist yet (the common new-user case). The next call, `upsertProfileRole`, then sees no profile and **generates a username from the email**, inserting that instead. The user's choice never persists.
- **No uniqueness check.** The username column is `UNIQUE`; a taken name throws an unhandled DB error (500) instead of a friendly message. The photographer profile editor already does this check — onboarding does not.
- **i18n violation.** The role/username UI hardcodes English strings, against the project rule that all visible strings live in both `en.json` and `es.json`.
- **Validation errors are invisible.** `saveRole` redirects with `?message=invalid_username`, but the onboarding page never reads or renders that param.
- **No tests** cover the onboarding username path.

The data model already fully supports user-chosen usernames (required, unique, format-checked `^[a-z0-9_-]+$`, 3–30 chars, plus a `slug` mirror trigger). **No migration is needed** — this is an application-layer correctness + UX + i18n fix.

## What Changes

- **Fix the persistence bug**: persist the user's chosen username atomically during onboarding so it is never overwritten by the email-derived fallback. The chosen value must survive whether or not a profile row already exists.
- **Add uniqueness validation** at onboarding with a friendly, localized "username taken" error (mirroring `updateProfileAction`), plus format/length validation feedback.
- **Mirror `username` → `slug`** for photographers on first onboarding so public profile URLs resolve immediately (currently only guaranteed by the INSERT trigger, which the buggy flow bypasses).
- **Localize all onboarding strings** (role cards, username label/help/placeholder, validation/error messages) in both `en.json` and `es.json`; the form consumes the dictionary instead of hardcoded English.
- **Render validation/error messages** on the onboarding page from the redirect `message` param.
- **(Enhancement) Real-time availability check**: a debounced server action that tells the user whether a username is free before submit.
- **Add tests**: regression test proving the chosen username persists (fails before the fix), plus uniqueness, format, and slug-mirroring coverage.
- **Deliver a `/workflows` multi-agent harness** (script artifact) that implements + reviews this change with parallel agents and a loop-until-clean verification stage, and an apply prompt for a fresh session.

## Capabilities

### New Capabilities
- `onboarding-username`: Choosing, validating, and persisting a unique user-selected username during the role-selection onboarding step, including localization, error surfacing, slug mirroring, and optional availability checking.

### Modified Capabilities
<!-- None: there are no existing OpenSpec specs in openspec/specs/ to amend. -->

## Impact

- **Code (app)**: `app/[lang]/onboarding/role/page.tsx` (saveRole, render message), `components/onboarding-role-form.tsx` (i18n, error display, availability UX), `app/[lang]/actions/roles.ts` (`completeOnboarding` persistence + uniqueness), optional new `checkUsernameAvailability` server action.
- **Code (data layer)**: `database/queries/profiles.ts` — `upsertProfileRole` / a new helper must accept and persist an explicit username + slug rather than regenerating from email.
- **i18n**: `dictionaries/en.json`, `dictionaries/es.json` — new `onboarding.*` keys.
- **Tests**: `test/integration/actions/` (onboarding/roles), unit tests for any extracted pure validation helper.
- **Database**: none — schema, constraints, unique index, and slug trigger already exist (`profiles.username`, `profiles_username_unique_idx`, `profiles_username_format_check`, `trg_set_profile_slug`).
- **No breaking changes**: existing users keep their (possibly email-derived) usernames; only the onboarding write path changes.

> **Dependency note (added during implementation):** this change fixes `completeOnboarding`, but on the primary auth paths (Google OAuth, email confirmation) a roleless user never *reaches* `completeOnboarding` — `/auth/callback` routes them to `/dashboard`, where `getActiveRole()` mints a default profile with an email-derived username before onboarding can run. The `fix-onboarding-bypass` change makes onboarding reachable (callback → `/onboarding/role`, side-effect-free role resolution, dashboard gate). The username fix here is correct but only takes effect end-to-end once `fix-onboarding-bypass` lands. No code change to this proposal — note only.
