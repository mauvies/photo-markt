/**
 * Pure kernel for the Supabase security-advisor gate (T-225).
 *
 * WHY THIS EXISTS: Supabase's security linter found the PR #279 email leak in a
 * single call, and it lived in no workflow — it ran only when somebody
 * remembered to look, which is exactly what did not happen for eighteen months.
 * It catches the class of defect that RLS, the test suite and migration review
 * all miss: `SECURITY DEFINER` functions exposed to `anon`, RLS enabled with no
 * policies, functions with a mutable `search_path`, extensions in `public`.
 *
 * It does NOT replace the SECURITY DEFINER inventory test that shipped with
 * #279. That one runs against the schema rebuilt from `supabase/migrations/`;
 * this one runs against a real project and therefore sees drift the migrations
 * do not describe — and the incident proved those two schemas are not the same.
 *
 * Everything here is pure so it can be unit-tested without a network call; the
 * fetching, the file reading and the exit code live in
 * `scripts/check-supabase-advisors.ts`.
 */

/** A single finding as returned by `GET /v1/projects/{ref}/advisors/security`. */
export type AdvisorLint = {
  name: string;
  level: string;
  title?: string;
  detail?: string;
  remediation?: string;
  metadata?: {
    name?: string;
    schema?: string;
    arguments?: string;
  } | null;
};

/** One accepted finding. `reason` is the whole point of the file. */
export type BaselineEntry = {
  key: string;
  level: string;
  reason: string;
};

export type AdvisorBaseline = {
  projectRef: string;
  accepted: BaselineEntry[];
};

export type AdvisorDiff = {
  /** Findings at a level that fails the build. */
  blocking: AdvisorLint[];
  /** Blocking findings that nobody has accepted — these fail the build. */
  undeclared: AdvisorLint[];
  /** Accepted entries the project no longer reports. Reported, never fatal. */
  stale: BaselineEntry[];
};

/**
 * Levels that fail the build. `INFO` does not: the seven current
 * `rls_enabled_no_policy` findings are INFO and are the *correct* configuration
 * here (RLS on with no policies is total denial — the documented `admin_users`
 * / `rate_limit_buckets` pattern). They are still declared in the baseline so
 * that the reasoning is written down and the gate does not suddenly go red if
 * Supabase ever raises that lint's level.
 */
export const BLOCKING_LEVELS: readonly string[] = ['ERROR', 'WARN'];

/**
 * Stable identity for a finding.
 *
 * Deliberately NOT the API's own `cache_key`: for `function_search_path_mutable`
 * that string ends in a hash of the function definition, so editing a trigger
 * body would retire the baseline entry and fail CI with a key nobody can read.
 * `<lint>:<schema>.<name>(<args>)` changes only when the thing being flagged
 * changes identity — which is exactly when the acceptance deserves re-reading.
 *
 * Auth-level lints carry no entity metadata; for those the lint name IS the key.
 */
export function advisorKey(lint: AdvisorLint): string {
  const name = lint.metadata?.name;
  if (!name) return lint.name;

  const schema = lint.metadata?.schema;
  const qualified = schema ? `${schema}.${name}` : name;
  const args = lint.metadata?.arguments;

  return args ? `${lint.name}:${qualified}(${args})` : `${lint.name}:${qualified}`;
}

export function isBlocking(lint: AdvisorLint): boolean {
  return BLOCKING_LEVELS.includes(lint.level.toUpperCase());
}

export function diffAdvisors(lints: AdvisorLint[], baseline: AdvisorBaseline): AdvisorDiff {
  const accepted = new Set(baseline.accepted.map((entry) => entry.key));
  const reported = new Set(lints.map(advisorKey));

  const blocking = lints.filter(isBlocking);

  return {
    blocking,
    undeclared: blocking.filter((lint) => !accepted.has(advisorKey(lint))),
    // Compared against EVERY reported key, not just the blocking ones: an
    // accepted INFO finding is still being reported, so it is not stale.
    stale: baseline.accepted.filter((entry) => !reported.has(entry.key)),
  };
}

/** Human-readable report. The undeclared block is what a reviewer has to act on. */
export function formatReport(diff: AdvisorDiff): string {
  const lines: string[] = [];

  if (diff.stale.length > 0) {
    lines.push(`ℹ️  ${diff.stale.length} baseline entr(y|ies) no longer reported — prune them:`);
    for (const entry of diff.stale) lines.push(`   - ${entry.key}`);
    lines.push('');
  }

  if (diff.undeclared.length === 0) {
    lines.push(
      `✅ No undeclared security advisors (${diff.blocking.length} blocking-level finding(s), all accepted in the baseline).`,
    );
    return lines.join('\n');
  }

  lines.push(`❌ ${diff.undeclared.length} undeclared security advisor finding(s):`);
  for (const lint of diff.undeclared) {
    lines.push('');
    lines.push(`   [${lint.level}] ${advisorKey(lint)}`);
    if (lint.detail) lines.push(`   ${lint.detail}`);
    if (lint.remediation) lines.push(`   → ${lint.remediation}`);
  }
  lines.push('');
  lines.push(
    'Fix the finding, or accept it in supabase/advisors-baseline.json with a one-line reason.',
  );

  return lines.join('\n');
}
