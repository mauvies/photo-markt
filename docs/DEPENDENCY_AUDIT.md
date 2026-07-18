# Dependency Audit (T-151)

Generated: 2026-07-18 · Branch `chore/dependency-audit-tiered`

Part 1 of T-151 — **audit only, no changes applied**. This report groups the current
dependency state by risk so we can decide which tiers to apply. Part 2 applies the
approved tiers as separate reviewable changes. Nothing here has been installed or bumped.

Reproduce with:

```bash
pnpm audit          # security advisories
pnpm outdated       # outdated packages
pnpm why <pkg>      # dependency chain for a transitive package
```

---

## 1. Security — `pnpm audit`

**3 vulnerabilities: 1 high, 2 moderate. All are transitive and dev/build-time; none sit
on a production request path, and the two Windows-only ones don't apply to our
macOS-dev / Linux-Vercel runtime.** Still worth patching — all are one-line fixes.

| Sev | Package | Vulnerable | Patched | Chain | CVE / Advisory | Real exposure here |
|-----|---------|------------|---------|-------|----------------|--------------------|
| **high** | `vite` | `>=8.0.0 <=8.0.15` (we have `8.0.12`) | `>=8.0.16` | `vitest > vite` (**dev only**) | GHSA-fx2h-pf6j-xcff / CVE-2026-53571 — `server.fs.deny` bypass via Windows alternate paths | **None in prod.** Vite is only pulled by vitest (test runner). Not shipped. Bypass is Windows-path specific. |
| moderate | `vite` | `>=8.0.0 <=8.0.15` | `>=8.0.16` | `vitest > vite` (**dev only**) | GHSA-v6wh-96g9-6wx3 / CVE-2026-53632 — `launch-editor` NTLMv2 hash disclosure via UNC path | **None in prod.** Requires running the Vite dev server **on Windows** and visiting an attacker page. We don't run Vite dev; devs are on macOS. |
| moderate | `postcss` | `<8.5.10` (we have `8.4.31`) | `>=8.5.10` | `next > postcss` (**build time**) | GHSA-qx2v-qp2m-jg93 / CVE-2026-41305 — XSS via unescaped `</style>` when re-stringifying **user-submitted CSS** | **Not exploitable in our usage.** Next uses postcss to compile Tailwind at build time; we never parse+re-stringify user-supplied CSS. A patched `postcss@8.5.19` already resolves for `@tailwindcss/postcss`/`vite` — only the Next-bundled copy is stale. |

### Suggested fixes (both are `pnpm.overrides`, no major bumps)

Both vulnerable copies are **transitive** — we don't depend on `postcss` or `vite`
directly, so the fix is a `pnpm.overrides` pin in `package.json`, then `pnpm install`:

```jsonc
"pnpm": {
  "overrides": {
    "postcss@<8.5.10": ">=8.5.10",   // dedupes to the 8.5.19 already in the tree
    "vite@<8.0.16": ">=8.0.16"        // dev-only (vitest); pin the deny-bypass fix
  }
}
```

- The `postcss` override just dedupes onto the `8.5.19` already present — very low risk.
- The `vite` override moves vitest's vite from `8.0.12 → >=8.0.16` (patch range, same major `8`).
  Requires a green `pnpm test` after — vitest 4.x supports vite 8 patch line.

---

## 2. Outdated — `pnpm outdated`, grouped by tier

### Tier 1 — patch / minor, same major (low risk, no API breakage expected)

| Package | Current | Latest | Kind | Notes |
|---------|---------|--------|------|-------|
| `next` | 16.2.6 | 16.2.10 | prod | Patch line 16.2.x. **May also carry the patched postcss** — verify with `pnpm why postcss` after. |
| `react` | 19.2.1 | 19.2.7 | prod | Patch. Bump with `react-dom` in lockstep. |
| `react-dom` | 19.2.1 | 19.2.7 | prod | Patch. Must match `react`. |
| `@supabase/supabase-js` | 2.110.5 | 2.110.7 | prod | Patch. |
| `@aws-sdk/client-rekognition` | 3.1087.0 | 3.1090.0 | prod | Patch. |
| `@sentry/nextjs` | 10.65.0 | 10.66.0 | prod | Minor, same major 10. |
| `inngest` | 4.12.1 | 4.13.0 | prod | Minor, same major 4. No pending major. Smoke-test the workers after. |
| `lucide-react` | 1.24.0 | 1.25.0 | prod | Minor (icons). |
| `@biomejs/biome` | 2.3.8 | 2.5.4 | dev | Minor. May surface **new lint findings** — run `pnpm lint` after; fix or `biome migrate`. |
| `@tailwindcss/postcss` | 4.3.2 | 4.3.3 | dev | Patch. Bump with `tailwindcss`. |
| `tailwindcss` | 4.3.2 | 4.3.3 | dev | Patch. |

### Tier 1 — **caution** (pre-1.0 `0.x` minor = potentially breaking; and native libs)

Semver treats a `0.x` minor bump as allowed-to-break. Group these but verify a full
`pnpm build` + smoke test, not just typecheck.

| Package | Current | Latest | Kind | Why caution |
|---------|---------|--------|------|-------------|
| `sharp` | 0.34.5 | 0.35.3 | prod | Native image lib (`0.34 → 0.35` minor-but-0.x). Powers watermark/thumbnail pipeline. **Memory: sharp in the client bundle broke a build before** → must run `pnpm build` (not just typecheck), and smoke-test upload → Inngest thumbnails → watermark. |
| `@supabase/ssr` | 0.10.3 | 0.12.3 | prod | `0.10 → 0.12` crosses two `0.x` minors — auth/session cookie handling (`src/proxy.ts`, server/client Supabase clients). Higher blast radius than the version number suggests; review the changelog. Consider splitting to its own change. |
| `supabase` (CLI) | 2.108.0 | 2.109.1 | dev | **Memory: a CLI/Homebrew version mismatch (2.107 pnpm vs 2.108 brew) broke config parse + CI before.** Bump only if the local Homebrew CLI is moved in lockstep; otherwise hold. Local-dev tooling only — no prod impact. |

### Tier 2 — security fixes

Covered by §1: `postcss` and `vite` overrides. Neither requires a major bump. If we bump
`next` in Tier 1, re-check whether it already ships patched `postcss` and drop that override.

### Tier 3 — majors (breaking; **out of scope for this ticket** → separate follow-up tickets)

Per T-151, high-blast-radius majors are recommended as dedicated tickets, not bundled here.

| Package | Current | Latest | Jump | Blast radius | Recommendation |
|---------|---------|--------|------|--------------|----------------|
| `stripe` | 20.4.1 | 22.3.2 | **major ×2** (20→21→22) | **Payments — highest.** Live Stripe. API-version pin + typed resource changes across checkout, webhook, Connect transfers, subscriptions. | **Dedicated ticket.** Follow Stripe SDK v21 + v22 migration guides one at a time; `/code-review ultra` on the diff. |
| `typescript` | 5.9.3 | 7.0.2 | **major, skips 6** (5→7) | Whole codebase typecheck. TS 7 is the native/Go compiler rewrite — behavior + flag changes. | **Dedicated ticket.** Verify `tsc --noEmit` clean; check Biome/vitest TS-version compat. |
| `archiver` | 7.0.1 | 8.0.0 | major | ZIP download route (`/api/events/[id]/download`). | **Dedicated ticket** (small, isolated). Bump with `@types/archiver` 7→8; smoke-test purchased-photos ZIP download. |
| `@types/archiver` | 7.0.0 | 8.0.0 | major (dev) | Types only. | Ships **with** the `archiver` 8 ticket. |
| `@types/node` | 25.9.5 | 26.1.1 | major (dev) | Types only; tracks Node line. | Low risk; can ride the TypeScript ticket or its own small change. Verify Node runtime target (Vercel) matches. |

**High-risk majors with no pending major (nothing to do):** `next` (only 16.2.x patch),
`react`/`react-dom` (only 19.2.x patch), `@supabase/supabase-js` (only patch), `inngest`
(only 4.13 minor). None need a major-bump ticket right now.

**Deprecated / unmaintained:** none found in the outdated set.

---

## 3. Recommended application order (Part 2, once approved)

1. **Tier 2 (security overrides)** — `postcss` + `vite` overrides. Smallest, highest value.
   Own PR. `pnpm install && pnpm test && pnpm build`.
2. **Tier 1 (patch/minor)** — the low-risk table. Own PR. Full green gate + smoke test.
3. **Tier 1-caution** — `sharp`, `@supabase/ssr` reviewed individually (maybe their own PRs);
   `supabase` CLI only alongside a matching Homebrew move.
4. **Tier 3 majors** — file with `/ticket` **per package** (Stripe, TypeScript, archiver);
   not in this ticket.

Every applied tier must pass `pnpm build` (production) + `pnpm typecheck` + `pnpm lint` +
`pnpm test`, plus a manual smoke test of checkout/payment, Stripe webhook, auth/session,
the image pipeline (upload → Inngest → thumbnails), and face/bib search.

**⏸ STOP — awaiting decision on which tiers to apply before any install.**
