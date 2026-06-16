## 1. Gather sources of truth

- [x] 1.1 Re-read `env.mjs` and list every required (non-optional) variable, noting which are optional
- [x] 1.2 Confirm plan ids/names/commission from `lib/plans.ts` + `lib/plan-limits.ts` (free/starter/pro · 12/8/5%)
- [x] 1.3 Confirm `AI_MATCHING: true` in `lib/feature-flags.ts` and note the live stack files (`lib/aws/`, `lib/inngest/`, `app/api/inngest/route.ts`, `database/queries/rekognition.ts`, `lib/safe-call.ts`) — mapped the full Rekognition + Inngest flow; legacy pgvector/CLIP schema was dropped in migration `20260518000000`
- [x] 1.4 Grep the repo for links to lowercase `architecture.md` to repoint before deletion — none found

## 2. Update README.md

- [x] 2.1 Change the feature-flags note from "AI matching currently disabled" to enabled; mention Rekognition + Inngest in the tech stack
- [x] 2.2 Rename plans Amateur→Free/Starter/Pro (keep "Amateur" only inside the `STRIPE_PRICE_AMATEUR` var name); fix the Stripe Setup section
- [x] 2.3 Complete the env block to mirror `env.mjs` (AWS Rekognition, Inngest, yearly price IDs), marking optional vars — phantom vars (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `SUPABASE_JWT_SECRET`, `PLATFORM_FEE_BPS`, `RESEND_FROM_EMAIL`) deliberately omitted: not in `env.mjs` nor used in code (spec corrected)
- [x] 2.4 Add brief coverage of collaborative/guest events and Stripe Connect payouts; fix role action path to `app/[lang]/actions/roles.ts`

## 3. Update CLAUDE.md

- [x] 3.1 Remove/correct every statement that AI matching is disabled (Feature flags, AI Photo Search, photos/ai_search_profiles schema, feature-branch table) to reflect it is enabled; added `photo_faces` table and the real Rekognition + Inngest flow
- [x] 3.2 Reconcile stale facts: corrected the "weekly payout cron + $25 threshold" claim (×2) to per-order webhook transfers, matching ARCHITECTURE §4.3; added AI/background-jobs to Tech Stack
- [x] 3.3 Time-sync (events schema), collaborative events (event_photographers), and username rules are already documented in CLAUDE.md; no gap

## 4. Update ARCHITECTURE.md

- [x] 4.1 Rewrote §6 (PLANNED·DISABLED → ENABLED): real Rekognition + Inngest indexing/search flow, lifecycle functions, `safeCall`, new status table; redrew §1 system-context diagram
- [x] 4.2 Refreshed §7 tech stack (AWS Rekognition, Inngest, Vitest replacing the wrong `tsx`/`node:test` row, pgvector→unused); rewrote §3 ER diagram (dropped `photo_embeddings`/`selfie_embedding`, added `photo_faces` + events Rekognition columns + photos status columns); updated legacy-schema findings
- [x] 4.3 Verified cross-references: removed stale discrepancy list (sales.ts/earnings.ts DO exist as query modules; payout + AI claims now agree with the fixed CLAUDE.md)

## 5. Resolve duplicate architecture file

- [x] 5.1 Investigated: `architecture.md` and `ARCHITECTURE.md` are the SAME inode (26361859). On this case-insensitive APFS volume there is exactly one directory entry (`ARCHITECTURE.md`) — not a real duplicate. No `git rm`: it would delete the only file. No action needed
- [x] 5.2 No links to repoint (task 1.4 found none)
- [x] 5.3 Confirmed `git ls-files` tracks exactly one `ARCHITECTURE.md` and `ls` shows a single directory entry

## 6. Verify

- [x] 6.1 Walked every spec scenario: AI enabled (no stale "disabled" left), plans Free/Starter/Pro, single ARCHITECTURE.md, shipped features covered, cross-doc facts consistent — all pass. Caught + fixed a missed wrong role path in CLAUDE.md
- [x] 6.2 Diffed README env block vs `env.mjs`: all 18 validated vars present, zero phantom vars leaked
- [x] 6.3 `pnpm spell` only covers `.ts`/`.tsx` (not markdown); skimmed the three docs — mermaid diagrams and links intact
