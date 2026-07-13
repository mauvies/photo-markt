## 1. Home-redirect exemption for talent

- [ ] 1.1 Update `homeRedirectPath` (`src/lib/auth/home-redirect.ts`) to return `null` for `ROLES.TALENT`, keeping photographer and unknown/roleless behavior unchanged.
- [ ] 1.2 Update `test/unit/lib/home-redirect.test.ts`'s `TALENT` expectation to `null`, with a comment referencing T-118.

## 2. Route consolidation

- [ ] 2.1 `src/app/[lang]/dashboard/talent/page.tsx`: change redirect target from `/dashboard/talent/events` to `/`.
- [ ] 2.2 `src/app/[lang]/dashboard/talent/events/page.tsx`: replace its `ExplorePageContent` render with a redirect to `/`.
- [ ] 2.3 `getDashboardPath()` (`src/app/[lang]/actions/roles.ts`): return `/` for talent instead of `/dashboard/talent/events`.
- [ ] 2.4 Confirm (read, don't change) that `/events/[shareCode]/page.tsx`'s existing per-event redirect for authenticated talent, and `/dashboard/talent/events/[id]`, are untouched.

## 3. Landing page rewrite

- [ ] 3.1 Rewrite `src/app/[lang]/page.tsx`: compact hero (title only, not full-height) → `ExplorePageContent` (search + paginated grid, `eventLinkPrefix="/events"`) → footer (footer already renders via `ConditionalFooter` at `/`, unchanged). Remove the `FeaturedEvents`, pricing, "How It Works", and final-CTA sections.
- [ ] 3.2 Delete `src/app/[lang]/featured-events.tsx`, `src/app/[lang]/top-events-actions.ts`, and `test/unit/components/featured-events.test.tsx` after grepping to confirm no remaining callers.
- [ ] 3.3 Add a one-line "reserved for a future photographer landing" comment to the top of `src/components/pricing-section.tsx`; leave the component itself unmodified and unreferenced.
- [ ] 3.4 Remove now-orphaned `home.*` keys from `en.json`/`es.json` (`heroSubtitle`, `featuredEventsTitle`, `exploreAllEvents`, `noEventsAvailableYet`, `howItWorksLabel/Headline/Subtitle`, `pillar1-3Title/Body`, `ctaHeadline/Subtitle/ctaCreateAccount/ctaHaveAccount`, `statusAll/Upcoming/Completed`) after grepping each key to confirm no other reader; add any new strings the compact hero needs.

## 4. Shared talent header actions

- [ ] 4.1 Add a client hook to read the current user's active role (mirrors `useAuthUser`'s react-query pattern), backed by `getActiveRole()`/`getRoleContext()`.
- [ ] 4.2 Add `FavoritesLinkButton` (Heart icon, links to `/dashboard/talent/favorites`, reserved `h-10 w-10` slot like `CartLinkButton`, always visible — no count gate).
- [ ] 4.3 Add `"Orders"` item to `DashboardUserMenu` (desktop) and `BottomNavAccount` (mobile), talent-only, linking to `/dashboard/talent/orders`.
- [ ] 4.4 Add `TalentHeaderActions` component composing `[CartLinkButton if count > 0] [FavoritesLinkButton] [DashboardUserMenu]`.
- [ ] 4.5 `Nav` (`src/components/nav.tsx`): add a talent-authenticated branch (user present + active role is talent) that renders `TalentHeaderActions` instead of `UserAvatar`; switch its cart-visibility condition for this branch from the pathname allowlist to `useCartItemCount() > 0`. Photographer/unresolved-role behavior unchanged.
- [ ] 4.6 `TalentDashboardHeader` (`src/components/talent-dashboard-header.tsx`): remove `talentNavLinks` and its desktop `<nav>`; replace the `CartLinkButton` + `DashboardUserMenu` block with `TalentHeaderActions`.
- [ ] 4.7 `TalentDashboardHeader`'s mobile `<BottomNav>`: replace the `talentNavLinks`-derived tabs with `[FavoritesLinkButton-as-tab, Cart tab]`, keeping the `account` slot (`BottomNavAccount`) as-is.

## 5. Tests

- [ ] 5.1 Update/add component tests for `Nav`'s new talent branch (cart/favorites/avatar render when talent + non-empty cart; cart hidden when empty; photographer/anonymous branches unchanged).
- [ ] 5.2 Update `TalentDashboardHeader` tests (if any) or add new ones: nav links are gone, `TalentHeaderActions` renders, mobile bottom nav shows only Favorites + Cart tabs.
- [ ] 5.3 Add a regression test for the landing page composition: no pricing/how-it-works/CTA sections render, the paginated grid (not `FeaturedEvents`) is used.
- [ ] 5.4 Add/update tests for `DashboardUserMenu` and `BottomNavAccount` covering the new Orders item.
- [ ] 5.5 Add a regression test for the `/dashboard/talent` and `/dashboard/talent/events` redirects to `/`.

## 6. Verification

- [ ] 6.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] 6.2 Manually verify (dev server) both the anonymous and authenticated-talent home, and the talent dashboard sub-pages' header/bottom-nav, since this is a UI-heavy change.
