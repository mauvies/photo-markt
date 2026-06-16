## Context

Three contributor-facing docs — `README.md`, `CLAUDE.md`, `ARCHITECTURE.md` — have drifted from the codebase. Verified drift:

- `lib/feature-flags.ts` ships `AI_MATCHING: true`, but all three docs call AI matching disabled/planned. The feature is live across ~20 files (`lib/aws/`, `lib/inngest/`, `app/api/inngest/route.ts`, `database/queries/rekognition.ts`, `searchFacesInEvent`).
- `package.json` pins `next@16.2.6`; README already says "Next.js 16", but plan naming and env coverage lag.
- `lib/plans.ts` defines tiers `free` / `starter` / `pro` (commission 12% / 8% / 5%). README still says "Amateur/Pro".
- `app/[lang]/actions/roles.ts` is the real role-assignment path; README/CLAUDE reference `app/actions/roles.ts`.
- `architecture.md` and `ARCHITECTURE.md` share one inode — a case-only duplicate.

This is documentation-only. No code, schema, dependency, or API changes.

## Goals / Non-Goals

**Goals:**
- Make all three docs factually match the current implementation, with `env.mjs` and `lib/*` as the source of truth.
- Resolve cross-doc contradictions (plan names, paths, versions) so the three docs agree.
- Collapse the duplicate architecture file to a single `ARCHITECTURE.md`.

**Non-Goals:**
- No rewrite of doc structure or tone — edit in place, preserve existing sections and ordering.
- No documentation of the over-engineering audit findings (separate concern).
- No new product features, code, or config changes.
- Not touching `docs/*.md` deep-dives (AI_MATCHING_AUDIT, etc.) — those are historical records, out of scope.

## Decisions

**Source of truth = code, not the other docs.** When docs disagree, reconcile against `env.mjs`, `lib/plans.ts`, `lib/feature-flags.ts`, and the actual file tree. Rationale: the code is what runs; a doc agreeing with another stale doc is still wrong.

**Keep `ARCHITECTURE.md` (uppercase), delete `architecture.md`.** Uppercase is the conventional name and the one cross-referenced. Because they're currently the same inode on a case-insensitive filesystem, the safe sequence is: copy contents out, `git rm` the lowercase path, ensure the uppercase path remains tracked. Verify with `git ls-files` that only `ARCHITECTURE.md` is tracked afterward.

**Edit in place, minimal diff.** Change only stale facts and add missing items; do not reflow or restructure. Rationale: smallest reviewable diff, lowest risk of introducing new inaccuracies.

**README env block mirrors `env.mjs` required vars.** Generate the list from `env.mjs` rather than hand-picking, so it stays complete. Mark genuinely optional vars (e.g. yearly price IDs, Google Places key) as optional.

**Alternatives considered:** Auto-generating docs from code (rejected — these docs are narrative/onboarding, not API reference; generation is overkill for three files). A single merged doc (rejected — README, CLAUDE, and ARCHITECTURE serve distinct audiences).

## Risks / Trade-offs

- **Deleting `architecture.md` could drop content if it's not truly identical** → it is the same inode (verified), so the uppercase file is byte-identical; confirm with `diff` before removing, and confirm the uppercase file survives in `git status`.
- **New drift introduced while editing** → cross-check every changed fact against the named source file; the spec scenarios act as the acceptance checklist.
- **Cross-references to `architecture.md` (lowercase) elsewhere break** → grep the repo for `architecture.md` links before deleting and repoint any to `ARCHITECTURE.md`.

## Migration Plan

Not applicable — documentation edits, no deploy or rollback. Reverting is a `git revert` of the docs commit.

## Open Questions

None. Scope and sources of truth are settled.
