/**
 * Runs Supabase's security advisors against a project and fails if anything at
 * `ERROR`/`WARN` is not declared in `scripts/advisors-baseline.ts` (T-225).
 *
 *   pnpm advisors:check
 *
 * Requires `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token).
 * `SUPABASE_ADVISORS_PROJECT_REF` overrides the ref; by default it is the one
 * pinned in the baseline, which is STAGING.
 *
 * ⚠️ The pinned project ref is the only thing keeping this off production. A
 * Supabase PAT is account-wide — there is no per-project management token — so
 * "the CI token cannot read prod" is not something the credential can enforce.
 * The versioned ref is the control, and changing it shows up in a diff. Do not
 * move it into a repository variable.
 *
 * All logic worth testing lives in `scripts/supabase-advisors.ts`; this file is
 * the I/O shell.
 */

import { ADVISORS_BASELINE } from './advisors-baseline';
import { type AdvisorLint, diffAdvisors, formatReport } from './supabase-advisors';

async function fetchSecurityAdvisors(projectRef: string, token: string): Promise<AdvisorLint[]> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/advisors/security`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );

  if (!response.ok) {
    // Surface the body: it carries the actual reason (bad token, wrong ref, rate
    // limit) and holds no secret. Degrading to a silent "0 findings" would be
    // the one failure mode that defeats the whole gate.
    throw new Error(
      `Supabase advisors API returned ${response.status} ${response.statusText}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { lints?: AdvisorLint[] };
  return body.lints ?? [];
}

async function main(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('SUPABASE_ACCESS_TOKEN is not set — cannot reach the Supabase advisors API.');
  }

  const projectRef = process.env.SUPABASE_ADVISORS_PROJECT_REF || ADVISORS_BASELINE.projectRef;

  console.log(`Running Supabase security advisors against project ${projectRef}…`);

  const diff = diffAdvisors(await fetchSecurityAdvisors(projectRef, token), ADVISORS_BASELINE);
  console.log(formatReport(diff));

  if (diff.undeclared.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
