# project-documentation Specification

## Purpose

The accuracy contract for the repo's contributor-facing docs (`README.md`, `CLAUDE.md`, `ARCHITECTURE.md`): what they must state to stay in sync with the implementation. Each requirement is a verifiable fact about the docs, so drift between code and documentation can be caught and corrected.

## Requirements

### Requirement: AI matching documented as enabled

The contributor docs (`README.md`, `CLAUDE.md`, `ARCHITECTURE.md`) SHALL describe AI photo matching as **enabled**, matching `lib/feature-flags.ts` (`AI_MATCHING: true`). No doc SHALL state the feature is "disabled", "planned", or "currently off". The live stack — AWS Rekognition for face indexing/search, Inngest as the background worker at `/api/inngest`, and `lib/safe-call.ts` for third-party error sanitization — SHALL be documented.

#### Scenario: README reflects enabled status

- **WHEN** a reader opens `README.md`
- **THEN** the feature-flags note states `AI_MATCHING` is enabled (not "currently disabled")
- **AND** the AWS Rekognition and Inngest dependencies are listed

#### Scenario: ARCHITECTURE describes the live AI stack

- **WHEN** a reader opens the AI-matching section of `ARCHITECTURE.md`
- **THEN** it is not marked "PLANNED · DISABLED"
- **AND** it documents the Rekognition + Inngest face-indexing and search flow

#### Scenario: CLAUDE.md flag note is accurate

- **WHEN** a reader opens `CLAUDE.md`
- **THEN** no statement claims `AI_MATCHING` is disabled

### Requirement: Subscription plans named consistently

All three docs SHALL refer to photographer subscription tiers as **Free**, **Starter**, and **Pro** with commission rates of 12%, 8%, and 5% respectively, matching `lib/plans.ts` and `lib/plan-limits.ts`. The legacy "Amateur" label SHALL only appear where it names the env var `STRIPE_PRICE_AMATEUR` (the Starter price ID).

#### Scenario: README plan names match code

- **WHEN** a reader reads the Stripe/plans section of `README.md`
- **THEN** plans are named Free / Starter / Pro
- **AND** "Amateur" appears only as part of the `STRIPE_PRICE_AMATEUR` env-var name

### Requirement: README environment list matches env.mjs

The `README.md` env-var section SHALL mirror the variables validated in `env.mjs` — the actual runtime contract — including AWS Rekognition (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `REKOGNITION_COLLECTION_PREFIX`), Inngest (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`), and Stripe yearly price IDs (`STRIPE_PRICE_AMATEUR_YEARLY`, `STRIPE_PRICE_PRO_YEARLY`). It SHALL NOT document variables that are neither validated in `env.mjs` nor read anywhere in code (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `SUPABASE_JWT_SECRET`, `PLATFORM_FEE_BPS`, `RESEND_FROM_EMAIL` are all unused as of this change).

#### Scenario: env vars in README cover env.mjs

- **WHEN** the env block in `README.md` is compared against `env.mjs`
- **THEN** every non-optional variable in `env.mjs` is present in the README
- **AND** no phantom variable absent from both `env.mjs` and the codebase is listed as required

### Requirement: Single architecture document

The repository SHALL contain exactly one architecture document, `ARCHITECTURE.md`. The lowercase `architecture.md` alias (currently the same inode) SHALL be removed so the file is unambiguous on case-insensitive filesystems.

#### Scenario: no duplicate architecture file

- **WHEN** the repository file list is inspected
- **THEN** `ARCHITECTURE.md` exists and `architecture.md` does not (as a separate directory entry)

### Requirement: Docs cover current shipped features

The docs SHALL mention the major features present in the codebase but currently undocumented: collaborative/guest events (guest photo uploads, bulk delete, photographer invitations), camera time-sync filtering, username persistence in onboarding, and Stripe Connect payouts (in `README.md`).

#### Scenario: collaborative events are documented

- **WHEN** a reader searches the docs for collaborative/guest event behavior
- **THEN** at least one of the three docs describes guest uploads and photographer invitations

### Requirement: Cross-doc facts are consistent

Where the three docs state the same fact, they SHALL agree: tech-stack versions (Next.js 16, React 19), the role-assignment action path (`app/[lang]/actions/roles.ts`), and the command tables.

#### Scenario: role action path is correct

- **WHEN** a reader follows the onboarding role-assignment reference in any doc
- **THEN** the path resolves to the actual file (`app/[lang]/actions/roles.ts`), not a non-existent `app/actions/roles.ts`
