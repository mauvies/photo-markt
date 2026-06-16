export const meta = {
  name: 'allow-user-set-username',
  description: 'Implement + adversarially verify user-chosen username at onboarding',
  whenToUse: 'Run to implement the allow-user-set-username OpenSpec change with parallel agents and a loop-until-clean verification stage.',
  phases: [
    { title: 'Implement', detail: 'one agent per workstream (query+action, form+i18n, availability, tests)' },
    { title: 'Verify', detail: 'loop-until-clean: typecheck/lint/test + adversarial regression reproducer' },
    { title: 'Synthesize', detail: 'diff summary + tasks.md checklist audit' },
  ],
};

// Shared context handed to every agent so they don't re-discover the codebase.
const CONTEXT = `
Repo: /Users/mauricio/code/picdemi (Next.js App Router, Supabase, Biome, Vitest).
OpenSpec change dir: openspec/changes/allow-user-set-username/ (read proposal.md, design.md, specs/onboarding-username/spec.md, tasks.md first).

Core bug to fix: app/[lang]/actions/roles.ts completeOnboarding() runs updateProfile({username})
(a no-op UPDATE when the profile row does not exist yet for a new user), then upsertProfileRole()
generates a username FROM EMAIL and inserts that — discarding the user's chosen username on the
primary signup path. profiles.username is NOT NULL/UNIQUE with CHECK(3-30, ^[a-z0-9_-]+$); slug
mirrors username via trg_set_profile_slug on INSERT. The correct uniqueness pattern already exists
in app/[lang]/dashboard/photographer/profile/update-action.ts.

Project rules (CLAUDE.md): all queries in database/queries/, all mutations via Server Actions,
all visible strings in BOTH dictionaries/en.json and dictionaries/es.json, no 'any', proper error
handling, every fix ships a regression test that fails before and passes after.
Return ONLY a concise structured result — your text is data, not a user message.
`;

const FILE_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'filesTouched'],
  properties: {
    summary: { type: 'string', description: 'What you changed and why, 2-4 sentences' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
};

const VERIFY_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['clean', 'failures'],
  properties: {
    clean: { type: 'boolean', description: 'true only if typecheck + lint + test all pass' },
    failures: { type: 'array', items: { type: 'string' }, description: 'each failing command + key error lines' },
  },
};

const REGRESSION_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['reproduces', 'evidence'],
  properties: {
    reproduces: { type: 'boolean', description: 'true if the chosen-username-discarded bug still occurs' },
    evidence: { type: 'string', description: 'code path / test output proving the verdict' },
  },
};

// ---- Phase 1: Implement (parallel workstreams, isolated worktrees) ----
phase('Implement');

const WORKSTREAMS = [
  {
    label: 'query+action',
    prompt: `${CONTEXT}
WORKSTREAM A — fix persistence (tasks 1, 2, 3, 6):
- Create lib/username.ts: pure normalizeUsername() + isValidUsername().
- In database/queries/profiles.ts let upsertProfileRole persist an explicit username + slug (slug = username),
  only falling back to generateUsernameFromEmail when no username supplied and none exists.
- Rewrite completeOnboarding() in app/[lang]/actions/roles.ts: normalize, uniqueness check (id != me),
  single upsert of role+username+slug; map a residual unique-violation to the friendly "taken" outcome.
- Update saveRole + page in app/[lang]/onboarding/role/page.tsx to use the helper and redirect with
  localized message codes; render searchParams.message.`,
  },
  {
    label: 'form+i18n',
    prompt: `${CONTEXT}
WORKSTREAM B — UI + i18n (task 4): add onboarding.* keys to BOTH dictionaries (role titles+descriptions,
usernameLabel/Help/Placeholder, usernameTooShort/Taken/Invalid, continue, availability checking/available/unavailable).
Refactor components/onboarding-role-form.tsx to take the dictionary slice as a prop and render the error
message from the page; remove every hardcoded English string. Coordinate prop shape with workstream A's page.`,
  },
  {
    label: 'availability',
    prompt: `${CONTEXT}
WORKSTREAM C — availability (task 5): add checkUsernameAvailability(candidate) server action returning
{available, reason?}, reusing lib/username.ts and treating the user's own username as available. Wire a
debounced (~400ms) availability indicator into the onboarding form using the new i18n keys.`,
  },
  {
    label: 'tests',
    prompt: `${CONTEXT}
WORKSTREAM D — tests (task 7): write Vitest integration tests under test/integration/actions/ for onboarding:
(1) regression — new user with NO profile keeps chosen username (must fail against the OLD code, pass after fix);
(2) taken username surfaces friendly error, no unhandled DB error; (3) invalid/short rejected, self-collision OK;
(4) photographer onboarding sets slug = username; (5) checkUsernameAvailability free/taken/own. Plus unit tests
for lib/username.ts. Use test/helpers/supabase-test-client.ts and beforeEach(resetDatabase).`,
  },
];

const implemented = await parallel(
  WORKSTREAMS.map((w) => () =>
    agent(w.prompt, { label: w.label, phase: 'Implement', schema: FILE_RESULT, isolation: 'worktree' }),
  ),
);
const built = implemented.filter(Boolean);
log(`Implement: ${built.length}/${WORKSTREAMS.length} workstreams produced changes`);

// ---- Phase 2: Verify (loop until two consecutive clean rounds, or budget) ----
phase('Verify');

let cleanStreak = 0;
let round = 0;
while (cleanStreak < 2 && round < 4 && (!budget.total || budget.remaining() > 60_000)) {
  round += 1;

  const [verify, regression] = await parallel([
    () =>
      agent(
        `${CONTEXT}
Run \`pnpm typecheck\`, then \`pnpm lint\`, then \`pnpm test\`. Report clean=true only if ALL pass.
If anything fails, FIX it in the repo (respect project conventions) and re-run until green or you are stuck;
list any command still failing with the key error lines.`,
        { label: `verify#${round}`, phase: 'Verify', schema: VERIFY_RESULT },
      ),
    () =>
      agent(
        `${CONTEXT}
ADVERSARIAL: try to prove the original bug still reproduces — that a brand-new user (no pre-existing profile row)
who picks a username at onboarding ends up with an email-derived username instead. Trace completeOnboarding and
the profiles query, and/or run the regression test. reproduces=true means the bug is NOT fixed. Give evidence.`,
        { label: `regression#${round}`, phase: 'Verify', schema: REGRESSION_RESULT },
      ),
  ]);

  const ok = verify?.clean === true && regression?.reproduces === false;
  if (ok) {
    cleanStreak += 1;
    log(`Verify round ${round}: clean (streak ${cleanStreak}/2)`);
  } else {
    cleanStreak = 0;
    log(`Verify round ${round}: not clean — failures=${(verify?.failures ?? []).length}, regression=${regression?.reproduces}`);
  }
}

// ---- Phase 3: Synthesize ----
phase('Synthesize');

const synthesis = await agent(
  `${CONTEXT}
The implementation and verification phases are done (verify clean streak reached: ${cleanStreak}, rounds: ${round}).
Produce a final report: (a) git diff --stat style summary of what changed, (b) walk through tasks.md and mark which
checkboxes are satisfied by the current repo state vs. still open, (c) confirm onboarding.* key sets match between
en.json and es.json, (d) list any residual risks. Keep it tight.`,
  { label: 'synthesize', phase: 'Synthesize' },
);

return {
  workstreams: built.map((b) => ({ summary: b.summary, files: b.filesTouched })),
  verifyClean: cleanStreak >= 2,
  verifyRounds: round,
  report: synthesis,
};
