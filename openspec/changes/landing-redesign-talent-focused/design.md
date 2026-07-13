## Context

Today there are three separate "browse events" surfaces and two headers:

- `/` (public landing): full-height hero + `EventSearchBar` + `FeaturedEvents` (top events only, no pagination) + pricing + "How It Works" + final CTA. Header: `Nav` (`src/components/nav.tsx`) — Login/Sign up when anonymous, a plain avatar dropdown (`UserAvatar`, no favorites/orders entry) when authenticated. Cart only shows on `/events`, `/cart`, `/checkout`.
- `/events` (public, all events, paginated): reuses `ExplorePageContent` (search + filter bar + `EventGrid` with "Load more"). Same `Nav` header.
- `/dashboard/talent/events` (talent-only, all events, paginated): the *same* `ExplorePageContent`, wrapped by `TalentDashboardHeader` (logo + desktop nav links `Explore/Favorites/Orders/Profile` + cart + `DashboardUserMenu`; mobile drops the header for a `BottomNav` with the same four tabs plus Cart, plus an `BottomNavAccount` avatar dropdown).
- `proxy.ts` middleware redirects any authenticated visitor of `/` away via `homeRedirectPath` (photographer → `/dashboard/photographer`, everyone else including talent → `/dashboard/talent`, which itself redirects to `/dashboard/talent/events`).

So talent already has a fully-paginated, filterable explore experience — it just lives behind a second URL with a second header, and an authenticated talent can never see `/` at all. This design's job is to collapse the "browse" surface into one page (`/`) and the "authenticated header" into one shared component, without touching the underlying search/filter/grid/favorites/orders/cart logic, which all already work and are reused as-is.

## Goals / Non-Goals

**Goals:**
- One URL (`/`) serves anonymous visitors and authenticated talent; only the header changes.
- One shared header-actions pattern (`[cart if non-empty] [favorites heart] [avatar dropdown with Orders+Profile]`) used by both the public `Nav` (talent branch) and `TalentDashboardHeader`, so "header simplificado" is literally one component, not two headers kept in sync by hand.
- Photographer-facing behavior is untouched: `Nav`'s plain-avatar branch for photographers, `homeRedirectPath` for `PHOTOGRAPHER`, `TalentDashboardHeader` is talent-only already so photographers never see these changes.
- No regression to onboarding: a just-signed-up user with no role yet must still be funneled to `/onboarding/role`.
- No dead code: `FeaturedEvents`/`top-events-actions.ts` are deleted once orphaned; unused `home.*` dictionary keys are removed.

**Non-Goals:**
- Rebuilding search, filters, pagination, favorites, orders, or cart logic — all reused verbatim via existing components/hooks.
- Touching `/events` (the public all-events page stays as a separate, shareable, no-header-chrome-required entry point — e.g. for links shared outside the app).
- Touching the per-event redirect (`/events/[code]` → `/dashboard/talent/events/[code]` for authenticated talent) or the `/dashboard/talent/events/[id]` detail route.
- A photographer-facing landing (pricing-section.tsx is preserved but not wired to anything new).
- Restructuring favorites/orders/profile/settings routes — only their entry point moves.

## Decisions

### 1. Reuse `ExplorePageContent` wholesale for the landing's event grid

`/` renders a compact hero (`<h1>`, no subtitle, no `min-h-[100svh]`) followed directly by `<ExplorePageContent eventLinkPrefix="/events" eventSearchBarDict={...} loadOnMount ... />` — the exact component `/events` already uses, dropping `FeaturedEvents` entirely. `eventLinkPrefix="/events"` (not `/dashboard/talent/events`) because `/` now serves both audiences uniformly; the existing per-event redirect inside `/events/[shareCode]/page.tsx` already forwards an authenticated talent to the dashboard-wrapped detail view, so this one prefix is correct for both anonymous and talent visitors and requires no new redirect logic.

**Alternative considered:** give the landing its own thin server-rendered top events section (current `FeaturedEvents`) *and* a "browse all" link to `/events`. Rejected — the ticket explicitly asks for the paginated grid inline, and keeping `FeaturedEvents` alive as a second, non-paginated events surface duplicates exactly the maintenance burden this change is trying to remove.

### 2. `homeRedirectPath` gets a talent exemption, not a wholesale removal

```ts
export function homeRedirectPath(isAuthenticated: boolean, role: UserRole | null | undefined): string | null {
  if (!isAuthenticated) return null;
  if (role === ROLES.TALENT) return null; // T-118: talent's home IS `/` now
  return role === ROLES.PHOTOGRAPHER ? '/dashboard/photographer' : '/dashboard/talent';
}
```

A `null`/unknown role (no profile row yet — brand new signup) still redirects to `/dashboard/talent`, which still gates through the talent layout's "no chosen role → `/onboarding/role`" check. This preserves the onboarding funnel exactly as-is; only an *already-onboarded* talent gets to stay on `/`.

**Alternative considered:** make `homeRedirectPath` return `null` for any non-photographer (including unknown role), then rely on a check elsewhere (e.g. the `/` page itself) to redirect roleless users to onboarding. Rejected — it would duplicate the onboarding gate that already exists in `dashboard/talent/layout.tsx`, and middleware is the cheaper, already-established place for this decision (it already fetches `profile.active_role` here).

### 3. `getDashboardPath()` sends talent to `/`; `/dashboard/talent` and `/dashboard/talent/events` both redirect to `/`

- `getDashboardPath()` (`src/app/[lang]/actions/roles.ts`, used by login, signup, onboarding completion, and the OAuth callback) returns `/` for talent instead of `/dashboard/talent/events`, so a fresh login/signup lands directly on the unified home.
- `src/app/[lang]/dashboard/talent/page.tsx` changes its redirect target from `/dashboard/talent/events` to `/` (this is also `dashboardHomeForRole('talent')`'s destination, so any in-app "go to my dashboard" link — e.g. the talent logo, or a role switch — lands on `/` after one hop).
- `src/app/[lang]/dashboard/talent/events/page.tsx` (the old dedicated explore page) also redirects to `/`. Once nav links are removed (Decision 4) nothing in the app links here anymore; leaving it as a live, functionally-identical duplicate page is exactly the kind of drift this change is meant to eliminate. `/dashboard/talent/events/[id]` (event detail) and `actions.ts`/`explore-page-content.tsx` (still used by `/events` and `/`) are untouched.

**Alternative considered:** leave `/dashboard/talent/events` rendering as before (dead-but-working). Rejected as unnecessary duplicate-maintenance surface now that nothing routes there; a redirect is a two-line change and fully reversible.

### 4. One shared header-actions component for authenticated talent

New client component `TalentHeaderActions({ user, activeRole, cartVariant, navLabels })` renders `[CartLinkButton if count > 0] [FavoritesLinkButton] [DashboardUserMenu]`, extracted so it can be dropped into two places:

- `Nav`: today it branches on `user` (undefined/null/User) to show a loading skeleton, Login/Sign up, or `UserAvatar`. It gains a fourth branch — `user` present AND the user's active role (fetched client-side via a new `useActiveRole()` hook, mirroring `useAuthUser`'s react-query + `staleTime` pattern) is `talent` — that renders `TalentHeaderActions` instead of `UserAvatar`. Photographers (or role not yet resolved) keep today's `UserAvatar` branch unchanged. Cart visibility switches from the current pathname allowlist (`/events`, `/cart`, `/checkout`) to `useCartItemCount() > 0` for this branch specifically — Nav is now a talent-shopping surface everywhere it renders, not just on three paths.
- `TalentDashboardHeader`: the desktop `<nav>` built from `talentNavLinks` (Explore/Favorites/Orders/Profile) is deleted; its right-hand slot (`CartLinkButton` + `DashboardUserMenu`) is replaced by the same `TalentHeaderActions`. The logo keeps linking to `dashboardHomeForRole(activeRole)` (`/dashboard/talent`, which now forwards to `/`).

Favorites is a new small component, `FavoritesLinkButton` (Heart icon, links to `/dashboard/talent/favorites`), mirroring `CartLinkButton`'s always-reserved `h-10 w-10` slot so it never causes layout shift — but always visible (no count gate; favorites has no analogous "hide when empty" product decision).

`DashboardUserMenu` (desktop) and `BottomNavAccount` (mobile) both gain a new "Orders" item (talent-only, alongside the existing Profile item) — since Orders no longer has a nav link or bottom-nav tab anywhere.

**Mobile (`BottomNav` inside `/dashboard/talent/*`):** the tab list built from `talentNavLinks` shrinks from four tabs to two: `[FavoritesLinkButton-as-tab, Cart tab]`, keeping the `account` slot (`BottomNavAccount`, now with Orders added) as-is. `Nav` itself is never mobile-hidden (unlike `TalentDashboardHeader`, which hides its header under `md:` and relies on `BottomNav` instead) — so on `/`, the three-icon header (cart/heart/avatar) is visible at every viewport size with no separate mobile treatment needed.

**Alternative considered:** keep `TalentDashboardHeader`'s desktop nav links as-is and only change `Nav`'s talent branch, leaving two different-looking authenticated headers. Rejected — the ticket's own title ("header simplificado") and Part 4's explicit cross-reference to Part 3's icon order read as one unified pattern, and maintaining two hand-synced headers is the same duplication problem this change is trying to close.

### 5. Delete orphaned landing sections instead of leaving them unreferenced

`FeaturedEvents` (`src/app/[lang]/featured-events.tsx`) and `top-events-actions.ts` have exactly one caller (`src/app/[lang]/page.tsx`) — confirmed via repo-wide search. Once the landing stops rendering them they have zero callers, so they (and their test file) are deleted rather than left as dead code. `pricing-section.tsx` is the one deliberate exception — the proposal and ticket explicitly call it out as reserved for a future photographer landing, so it stays with a one-line comment explaining why it's unreferenced.

`home.*` dictionary keys that become unused (`heroSubtitle`, `featuredEventsTitle`, `exploreAllEvents`, `noEventsAvailableYet`, `howItWorksLabel/Headline/Subtitle`, `pillar1-3Title/Body`, `ctaHeadline/Subtitle/ctaCreateAccount/ctaHaveAccount`, `statusAll/Upcoming/Completed`) are removed from both `en.json`/`es.json` after grepping to confirm no other reader (`statusAll`/`statusUpcoming`/`statusCompleted` also exist under other dictionary sections like `eventFilterBar`/`ordersList` with the same string value — only the `home.*` copies are removed).

## Risks / Trade-offs

- **[Risk]** Cart now appears on every public surface `Nav` renders (event detail, photographer profiles, etc.) for a talent with items, not just `/events`/`/cart`/`/checkout` → **Mitigation**: this is an intentional expansion per the ticket's "carrito solo cuando tiene ítems" (item-count gate, not path gate); the icon is still hidden at 0 items, so anonymous and empty-cart talent see no change.
- **[Risk]** `Nav` fetching `activeRole` client-side adds a second round-trip (after `useAuthUser`) before the talent header renders, so there's a brief window where a talent sees the generic avatar before flipping to the three-icon layout → **Mitigation**: same acceptable trade-off `useAuthUser` already made (a `Skeleton` fallback while `user === undefined`); extend the same "reserve space, don't flash" pattern to the role-resolution window.
- **[Risk]** Redirecting `/dashboard/talent/events` to `/` could break an external bookmark or an in-flight PR touching that route → **Mitigation**: it's a same-origin 1:1 redirect (not a 404), and the route's underlying component (`ExplorePageContent`) is untouched and still used at `/` and `/events`.
- **[Risk]** Removing `home.*` dictionary keys could collide with a concurrent branch still referencing them → **Mitigation**: grep both dictionaries for each key before deletion as a final check right before implementing (this is a fast, cheap safety check independent of anything else in this design).

## Migration Plan

No data migration. Deploy is a single PR/merge; rollback is a plain revert (no schema/DB changes, no feature flag needed — `homeRedirectPath`'s behavior change is the only "flip", and it's pure application logic).

## Open Questions

None outstanding — the ambiguity flagged in the ticket (how the unified header composes, and how `/dashboard/talent/events` relates to `/`) is resolved by Decisions 3 and 4 above.
