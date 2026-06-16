# Apply prompt — paste into a NEW Claude Code session

Copy everything in the fenced block below into a fresh session opened at the repo root
(`/Users/mauricio/code/picdemi`). It is self-contained.

---

```
Work on the OpenSpec change `allow-user-set-username` in this repo. Branch: feature/allow-user-set-username (already checked out — verify with `git status`; if not on it, create/switch to it).

First read these artifacts and follow them as the source of truth:
- openspec/changes/allow-user-set-username/proposal.md
- openspec/changes/allow-user-set-username/design.md
- openspec/changes/allow-user-set-username/specs/onboarding-username/spec.md
- openspec/changes/allow-user-set-username/tasks.md

CONTEXT YOU MUST KNOW (already investigated — do not re-litigate):
- The role-selection step (/onboarding/role) ALREADY renders a username field. The feature is BROKEN, not missing.
- The bug: in app/[lang]/actions/roles.ts, completeOnboarding() calls updateProfile({username}) which is a
  no-op UPDATE for a brand-new user (no profile row yet), then upsertProfileRole() generates a username FROM
  EMAIL and inserts that — discarding the user's chosen username on the primary signup path.
- profiles.username is NOT NULL + UNIQUE + CHECK(length 3-30, ^[a-z0-9_-]+$). slug mirrors username via the
  trg_set_profile_slug INSERT trigger. NO database migration is needed.
- The correct uniqueness pattern already exists in
  app/[lang]/dashboard/photographer/profile/update-action.ts (select id where username=X and id!=me → throw).

WHAT TO BUILD (tasks.md has the full ordered checklist — implement them in order):
1. lib/username.ts — pure normalizeUsername() + isValidUsername(), with unit tests.
2. Fix persistence: make the profile upsert accept an explicit username + slug; rewrite completeOnboarding to
   normalize → uniqueness-check → single upsert of role+username+slug. Map TOCTOU unique-violation to the
   friendly "taken" outcome.
3. saveRole + page: validate via the helper, redirect with localized message codes, and RENDER searchParams.message.
4. i18n: add all onboarding.* strings to BOTH dictionaries/en.json and dictionaries/es.json; refactor
   components/onboarding-role-form.tsx to render from the dictionary (no hardcoded English) and show the error.
5. checkUsernameAvailability() server action + debounced UI indicator.
6. Tests (test/integration/actions/): the regression test MUST fail against the current code and pass after your
   fix; plus uniqueness, format/self-collision, photographer slug=username, and availability tests.

PROJECT RULES (from CLAUDE.md — enforce strictly):
- All DB queries live in database/queries/. All mutations are Server Actions (no new API routes).
- Every visible string in BOTH en.json and es.json. No `any`. Proper error handling, no silent catches.
- Biome for format/lint. Each bug fix ships a regression test that fails before and passes after.

DEFINITION OF DONE:
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass (run `pnpm db:start` first for integration tests).
- A fresh account end-to-end (try both /es and /en) keeps its chosen username, slug mirrors it for photographers,
  /photographer/<username> resolves, taken/invalid usernames show localized errors, availability check works.
- Update the checkboxes in openspec/changes/allow-user-set-username/tasks.md as you complete them.

Proceed autonomously; do not ask for confirmation on low-risk steps. Do not commit or push unless I ask.

OPTIONAL — multi-agent harness: a ready-made Workflow script lives at
openspec/changes/allow-user-set-username/workflow.mjs (parallel implement → loop-until-clean verify → synthesize).
To run it, say "use a workflow" (or "ultracode") and invoke the Workflow tool with
{ scriptPath: "openspec/changes/allow-user-set-username/workflow.mjs" }. Otherwise implement the tasks directly.
```
