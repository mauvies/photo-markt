## Why

`README.md`, `CLAUDE.md`, and `ARCHITECTURE.md` have drifted from the current codebase. The most consequential gap is AI photo matching: all three docs describe it as **disabled/planned**, but `lib/feature-flags.ts` now ships `AI_MATCHING: true` and the feature is fully wired (AWS Rekognition + Inngest, ~20 call sites). The docs also disagree with each other on basic facts (plan names, file paths) and omit env vars required to run the app. Stale docs mislead both contributors and Claude Code — the AI-matching note already caused a wrong "this is dead code" conclusion during a recent audit.

## What Changes

- **AI matching status** — update all three docs from "disabled/planned" to "enabled". Document the live stack: AWS Rekognition (face indexing/search), Inngest (background worker at `/api/inngest`), `lib/safe-call.ts` error sanitization, and the `searchFacesInEvent` flow.
- **Plan naming** — reconcile the README's "Amateur/Pro" with the actual **Free / Starter / Pro** tiers (12% / 8% / 5% commission) used in `CLAUDE.md`, `lib/plans.ts`, and `lib/plan-limits.ts`.
- **Environment variables** — add the env vars missing from `README.md` that already exist in `env.mjs`/`CLAUDE.md`: AWS Rekognition (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `REKOGNITION_COLLECTION_PREFIX`), Inngest (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`), Stripe (`STRIPE_PRICE_AMATEUR_YEARLY`, `STRIPE_PRICE_PRO_YEARLY`, `PLATFORM_FEE_BPS`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`), and `SUPABASE_JWT_SECRET`, `RESEND_FROM_EMAIL`.
- **Feature coverage** — document features now in the codebase but absent from docs: collaborative/guest events (guest photo uploads, bulk delete, photographer invitations), camera time-sync filtering, username persistence in onboarding, Stripe Connect payouts (in README).
- **Duplicate file** — `architecture.md` and `ARCHITECTURE.md` are the **same inode** (a case-only duplicate that is fragile on case-insensitive filesystems). Standardize on a single `ARCHITECTURE.md` and remove the lowercase alias.
- **Cross-doc consistency** — align tech-stack versions (Next.js 16, React 19), file paths (`app/[lang]/actions/roles.ts` vs the docs' `app/actions/roles.ts`), and command tables across the three files.

## Capabilities

### New Capabilities
- `project-documentation`: The accuracy contract for the repo's contributor-facing docs (`README.md`, `CLAUDE.md`, `ARCHITECTURE.md`) — what they must state to stay in sync with the implementation. Each requirement is a verifiable fact about the docs.

### Modified Capabilities
<!-- None. No product/runtime behavior changes — the code already behaves this way; only the docs are being corrected to match. -->

## Impact

- **Files edited**: `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`.
- **Files removed**: `architecture.md` (lowercase duplicate of `ARCHITECTURE.md`).
- **No code, API, dependency, or schema changes.** Documentation only — zero runtime impact.
- **Sources of truth** consulted to fix drift: `lib/feature-flags.ts`, `env.mjs`, `lib/plans.ts`, `lib/plan-limits.ts`, `lib/aws/`, `lib/inngest/`, `app/api/inngest/route.ts`, recent migrations and git history.
