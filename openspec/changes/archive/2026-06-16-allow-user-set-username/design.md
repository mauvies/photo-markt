## Context

The role-selection onboarding step (`/onboarding/role`) already renders a username field, but the write path is broken. Current flow in `completeOnboarding(initialRole, username?)` (`app/[lang]/actions/roles.ts`):

```ts
if (username) {
  await updateProfile(supabase, user.id, { username }); // UPDATE ... WHERE id = userId
}
await dbUpsertProfileRole(supabase, user.id, role);       // generates username from email if no profile
await dbUpsertUserRole(supabase, user.id, role);
```

For a brand-new user there is **no profile row yet** (nothing in signup/callback/login creates one). So:
1. `updateProfile({ username })` updates **0 rows** — silent no-op, no error.
2. `upsertProfileRole` finds no profile → calls `generateUsernameFromEmail` → inserts the **email-derived** username, discarding the user's choice.
3. The INSERT fires `trg_set_profile_slug`, so `slug` mirrors the *email-derived* username, not the chosen one.

Relevant existing facts (verified):
- `profiles.username`: `NOT NULL`, `UNIQUE` (`profiles_username_unique_idx`), `CHECK (length 3–30 AND ~ '^[a-z0-9_-]+$')`.
- `profiles.slug`: partial-unique, auto-set to `username` on INSERT via `trg_set_profile_slug`.
- `updateProfileAction` (photographer settings) already implements the correct uniqueness pattern: `select id where username = X and id != me` → throw if found, and writes both `username` and `slug`.
- The onboarding UI hardcodes English; `dictionaries/*.json` only have `onboarding.roleTitle/roleSubtitle`.

No OpenSpec specs exist yet under `openspec/specs/`, so this introduces the first capability spec.

## Goals / Non-Goals

**Goals:**
- The user's chosen username persists reliably on the first onboarding, regardless of whether a profile row pre-exists.
- Uniqueness and format failures produce localized, on-page messages — never a 500 or a silently dropped choice.
- Photographer `slug` mirrors the chosen username.
- All onboarding strings localized (en + es).
- Tests cover the regression and the new behavior.
- Provide a runnable `/workflows` harness (multi-agent + loop) that implements and adversarially verifies the change, plus an apply prompt for a fresh session.

**Non-Goals:**
- No database migration (schema already supports everything).
- No change to how *existing* users' usernames were generated (backfill stays as-is).
- No change to the role model, OAuth flow, or `display_name` handling.
- Not adding username editing outside onboarding (photographer settings already covers that).

## Decisions

### D1: Persist username atomically inside the profile upsert (fixes the core bug)
Replace the broken update-then-upsert sequence. `completeOnboarding` will perform the uniqueness check, then write `active_role`, `username`, and (for photographers) `slug` in a **single upsert** so the chosen value cannot be clobbered by the email fallback.

Two implementation options:
- **(chosen) Extend the query layer**: add an optional `username` parameter to `upsertProfileRole` (or a small new `upsertProfileRoleWithUsername(supabase, userId, role, username)`), which upserts `{ id, active_role, username, slug? }` and only falls back to `generateUsernameFromEmail` when no username is supplied AND none exists. Keeps all profile writes in `database/queries/profiles.ts` per project convention.
- (rejected) Fix it inside the action by calling `upsertProfile` directly — bypasses the dedicated role query and duplicates fallback logic.

`slug` is set to the chosen username for photographers; for talent we can also set it harmlessly (it mirrors username and the trigger does the same on INSERT), so we set `slug = username` unconditionally for consistency with `updateProfileAction`.

### D2: Uniqueness check mirrors `updateProfileAction`
Before writing, run `select id from profiles where username = <normalized> and id != <me>`; if a row exists, return to the role step with `?message=username_taken` (localized). Rationale: identical, already-proven pattern; avoids relying on catching a Postgres unique-violation error string. A residual unique-violation (TOCTOU race) is still caught and mapped to the same friendly message as defense-in-depth.

### D3: Single normalization helper, shared by client, server action, and availability check
Extract a pure `normalizeUsername(raw): string` and `isValidUsername(value): boolean` (e.g. in `lib/username.ts`) applying lowercase + strip + 3–30 + regex. Used by: the client form (live), `saveRole` (authoritative), and `checkUsernameAvailability`. Pure functions → cheap unit tests, no DB. Rationale: today the rules are duplicated in three places with subtle drift.

### D4: Surface errors on the page
`saveRole` already redirects with `?message=...`. The page will read `searchParams.message` and pass a localized error string into the form. Keep the redirect-based approach (works with the existing server-action-as-form-action pattern) rather than converting to `useActionState`, to minimize blast radius.

### D5: i18n keys
Add under `onboarding.*` in both dictionaries: role card titles+descriptions, `usernameLabel`, `usernameHelp`, `usernamePlaceholder`, `usernameTooShort`, `usernameTaken`, `usernameInvalid`, `continue`, plus availability states (`checking`, `available`, `unavailable`). The form receives the dictionary slice as a prop (page is a server component, form is client).

### D6: Real-time availability (enhancement)
A `checkUsernameAvailability(candidate)` server action returns `{ available: boolean, reason?: 'invalid' | 'taken' }`. The client debounces (~400ms) and shows checking/available/taken. Rate-limit consideration: it's authenticated and cheap (single indexed select); no `lib/rate-limit.ts` needed at current scale, but keyed-by-user limiting is a noted future option.

### D7: Multi-agent `/workflows` harness
Ship `openspec/changes/allow-user-set-username/workflow.mjs` — a Workflow script that:
- **Phase Implement** (parallel): one agent per workstream (query-layer+action fix, form+i18n, availability action, tests) using `worktree` isolation so concurrent file edits don't collide... actually edits target mostly distinct files, but worktree isolation is specified to be safe, then results are merged.
- **Phase Verify (loop-until-clean)**: repeatedly run `pnpm typecheck`, `pnpm lint`, `pnpm test` via agents and an adversarial reviewer that tries to prove the chosen-username regression still reproduces; loop until two consecutive clean rounds or budget exhausted.
- **Phase Synthesize**: a final agent assembles the diff summary and checks every tasks.md item.
The harness is documented so the user can run it, and is invoked only with explicit opt-in.

## Risks / Trade-offs

- **[TOCTOU race on uniqueness]** Two users submit the same free username simultaneously → check passes for both, one INSERT/UPDATE hits the unique index → Mitigation: D2 catches the unique violation and maps it to the same localized "taken" message.
- **[Redirect-param error UX is coarse]** `?message=` round-trips the whole page and loses the typed username → Mitigation: acceptable for onboarding (rare, low-volume); the live availability check (D6) catches most cases before submit. Converting to `useActionState` is a possible future refinement, noted as non-goal here.
- **[Talent slug now set]** Setting `slug = username` for talent gives talent a slug they didn't have before → Low risk: the public route is gated by `active_role = 'PHOTOGRAPHER'` RLS/policy, so a talent slug is inert; it also matches the INSERT trigger's behavior.
- **[Worktree isolation overhead in the harness]** Spawning isolated worktrees per agent costs setup time → Mitigation: only the Implement phase uses isolation; verify/synthesize run in the main tree.
- **[i18n drift]** Forgetting a key in one dictionary → Mitigation: a verify-phase agent diffs the `onboarding.*` key sets between en/es.

## Migration Plan

1. No DB migration. Deploy is a standard app deploy.
2. Order of merge: query-layer fix + action fix first (restores correctness), then i18n + UI, then availability enhancement, then tests gating the lot.
3. **Rollback**: revert the branch; existing users are unaffected (their usernames already exist). No data backfill or down-migration required.
4. Post-deploy check: create a fresh test account end-to-end, confirm chosen username + slug persist and `/photographer/<username>` resolves.

## Open Questions

- Should we reserve a denylist of usernames (e.g. `admin`, `support`, `api`, route names)? Not in scope unless product wants it; the spec leaves room to add a reserved-words check in `isValidUsername`.
- Should onboarding also let users set `display_name` now? Out of scope here (editable later in settings), but the same step could host it cheaply if product wants it.
