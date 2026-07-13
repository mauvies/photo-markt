## 1. Home-redirect exemption for talent

- [x] 1.1 Update `homeRedirectPath` (`src/lib/auth/home-redirect.ts`) to return `null` for `ROLES.TALENT`, keeping photographer and unknown/roleless behavior unchanged.
- [x] 1.2 Update `test/unit/lib/home-redirect.test.ts`'s `TALENT` expectation to `null`, with a comment referencing T-118.

## 2. Route consolidation

- [x] 2.1 `src/app/[lang]/dashboard/talent/page.tsx`: change redirect target from `/dashboard/talent/events` to `/`.
- [x] 2.2 `src/app/[lang]/dashboard/talent/events/page.tsx`: replace its `ExplorePageContent` render with a redirect to `/`.
- [x] 2.3 `getDashboardPath()` (`src/app/[lang]/actions/roles.ts`): return `/` for talent instead of `/dashboard/talent/events`.
- [x] 2.4 Confirm (read, don't change) that `/events/[shareCode]/page.tsx`'s existing per-event redirect for authenticated talent, and `/dashboard/talent/events/[id]`, are untouched.

## 3. Landing page rewrite

- [x] 3.1 Rewrite `src/app/[lang]/page.tsx`: compact hero (title only, not full-height) → `ExplorePageContent` (search + paginated grid, `eventLinkPrefix="/events"`) → footer (footer already renders via `ConditionalFooter` at `/`, unchanged). Remove the `FeaturedEvents`, pricing, "How It Works", and final-CTA sections.
- [x] 3.2 Delete `src/app/[lang]/featured-events.tsx`, `src/app/[lang]/top-events-actions.ts`, and `test/unit/components/featured-events.test.tsx` after grepping to confirm no remaining callers. (Also deleted the now-orphaned `event-status-toggle.tsx` and `getTopEvents`/`TopEventCandidate` in `database/queries/events.ts`, both exclusive to the deleted files.)
- [x] 3.3 Add a one-line "reserved for a future photographer landing" comment to the top of `src/components/pricing-section.tsx`; leave the component itself unmodified and unreferenced.
- [x] 3.4 Remove now-orphaned `home.*` keys from `en.json`/`es.json` (`heroSubtitle`, `featuredEventsTitle`, `exploreAllEvents`, `noEventsAvailableYet`, `howItWorksLabel/Headline/Subtitle`, `pillar1-3Title/Body`, `ctaHeadline/Subtitle/ctaCreateAccount/ctaHaveAccount`, `statusAll/Upcoming/Completed`) after grepping each key to confirm no other reader. No new strings needed — the compact hero reuses `heroHeadline1`/`heroHeadline2`.

## 4. Shared talent header actions

- [x] 4.1 Add a client hook to read the current user's active role (mirrors `useAuthUser`'s react-query pattern), backed by `getActiveRole()`/`getRoleContext()`.
- [x] 4.2 Add `FavoritesLinkButton` (Heart icon, links to `/dashboard/talent/favorites`, reserved `h-10 w-10` slot like `CartLinkButton`, always visible — no count gate).
- [x] 4.3 Add `"Orders"` item to `DashboardUserMenu` (desktop) and `BottomNavAccount` (mobile), talent-only, linking to `/dashboard/talent/orders`.
- [x] 4.4 Add `TalentHeaderActions` component composing `[CartLinkButton (self-gated on count)] [FavoritesLinkButton] [DashboardUserMenu]`.
- [x] 4.5 `Nav` (`src/components/nav.tsx`): add a talent-authenticated branch (user present + active role is talent, via new `useActiveRole`) that renders `TalentHeaderActions` instead of `UserAvatar`/Login-Signup. Photographer/unresolved-role behavior unchanged (still the old pathname-gated cart + plain avatar). `[lang]/layout.tsx` merges the extra dashboard/role-label dict keys `Nav` needs into its `TranslationsProvider`.
- [x] 4.6 `TalentDashboardHeader` (`src/components/talent-dashboard-header.tsx`): remove `talentNavLinks` and its desktop `<nav>`; replace the `CartLinkButton` + `DashboardUserMenu` block with `TalentHeaderActions`. `dashboard/talent/layout.tsx`'s `navLabels` updated to match (drop `explore`, rename `myPhotos`→`favorites`).
- [x] 4.7 `TalentDashboardHeader`'s mobile `<BottomNav>`: replace the `talentNavLinks`-derived tabs with `[Favorites tab, Cart tab]`, keeping the `account` slot (`BottomNavAccount`, now with Orders added) as-is.

## 5. Tests

- [x] 5.1 Update/add component tests for `Nav`'s new talent branch (cart/favorites/avatar render when talent; plain avatar for photographer/anonymous unchanged). Existing T-114 cart-slot test updated to mock the new `useActiveRole` hook.
- [x] 5.2 Add `TalentDashboardHeader` tests: nav links are gone, `TalentHeaderActions` renders, mobile bottom nav shows only Favorites + Cart tabs.
- [x] 5.3 Add a regression test for the landing page composition: no pricing/how-it-works/CTA copy renders, the paginated grid (`ExplorePageContent`, not `FeaturedEvents`) is used.
- [x] 5.4 Add tests for `DashboardUserMenu` and `BottomNavAccount` covering the new Orders item (shown for talent with a label, hidden for photographer, hidden when no label).
- [x] 5.5 Add a regression test for the `/dashboard/talent` and `/dashboard/talent/events` redirects to `/`.

## 6. Verification

- [x] 6.1 `pnpm typecheck && pnpm lint && pnpm test` green (592 unit + 481 integration).
- [x] 6.2 Manually verified via dev server: anonymous `/` (hero + paginated grid, no pricing/how-it-works/CTA), `/dashboard/talent` and `/dashboard/talent/events` redirecting, an already-authenticated browser session hitting `getActiveRole`/`getCartItemCountAction`/`getSavedEventIdsAction` on `/` without errors. **Found and fixed a real regression during this check**: `Footer` had "How it works"/"Pricing"/"Photographer pricing" links pointing at `/#how-it-works` and `/#pricing` anchors that no longer exist anywhere in the app now that the landing dropped those sections — removed the dead links (and the now-orphaned "Product" group + its dict keys) from `footer.tsx`/`en.json`/`es.json`.

## 7. `/code-review high` follow-ups (verified findings)

- [x] 7.1 [correctness] `useActiveRole`'s `['active-role']` React Query cache was never invalidated on role switch, so the public `Nav` could render the old role's header for up to 5 min. Exported `ACTIVE_ROLE_KEY`; both switch handlers (`DashboardUserMenu`, `BottomNavAccount`) now `invalidateQueries` it after `switchRole()` succeeds.
- [x] 7.2 [correctness] `FavoritesLinkButton` hardcoded an un-prefixed `/dashboard/talent/favorites` href — `proxy.ts` would re-resolve the locale from `Accept-Language` and could silently switch language. Wrapped in `useLocalizedPath`.
- [x] 7.3 [correctness] The old explore route redirected unconditionally to `/`, silently dropping filter params on bookmarked/shared links. Now forwards a filtered request to `/events?<params>` (same `ExplorePageContent`, reads the same params) and a bare request to `/`.
- [x] 7.4 [correctness] Two double-redirect hops removed: the talent header logo now links straight to `/` (was `/dashboard/talent` → redirect → `/`); `completeOnboarding` sends a new talent to `/` directly (was `/dashboard/talent` → redirect → `/`). `dashboardHomeForRole` left unchanged (still a valid route, broader blast radius).
- [x] 7.5 [cleanup] `Nav` fired the `getActiveRole` round-trip even on `/dashboard/*`/`/login`/`/signup` routes where it returns `null`. Gated `useActiveRole(enabled)` on `!hideNav` so the wasted server hit is skipped.
- [x] 7.6 Refuted finding (no change): `DashboardUserMenu.handleSwitchRole` pushing an un-prefixed `/dashboard/<role>` — the verifier confirmed the mechanism but found it doesn't manifest as a real locale bug in the mounted context.
