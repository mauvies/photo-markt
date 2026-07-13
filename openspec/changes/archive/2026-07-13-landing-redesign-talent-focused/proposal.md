## Why

The public landing (`/`) mixes two audiences — talent looking for photos and photographers evaluating pricing — which dilutes the page's one real job: get a talent searching for their event as fast as possible. Authenticated talent never even see this page today (`proxy.ts` bounces them straight to `/dashboard/talent/events`), so the app effectively maintains two near-duplicate "browse events" experiences (public landing's `FeaturedEvents` teaser + the talent dashboard's paginated Explore) with two different headers. T-118 collapses this into one talent-focused home that serves both anonymous visitors and authenticated talent, with a single adaptive header.

## What Changes

- Landing (`/`) content reduced to: compact hero (title only, not full-height) → existing `EventSearchBar`/paginated event grid (reusing `ExplorePageContent`, not `FeaturedEvents`) → footer. Pricing, "How It Works", and the Final CTA sections are removed from `/`.
- `pricing-section.tsx` stays in the codebase, unreferenced, with a comment marking it reserved for a future photographer-facing landing. `FeaturedEvents`/`top-events-actions.ts` become fully unused once `/` stops rendering them and are deleted (no other caller — see Impact).
- **BREAKING** (internal routing, not a public API): an authenticated talent visiting `/` no longer redirects to a dashboard route — `homeRedirectPath` stays `null` for the `TALENT` role. Photographers are unaffected (still redirected to `/dashboard/photographer`); a not-yet-onboarded user is unaffected (still funneled toward onboarding via `/dashboard/talent`).
- `/dashboard/talent/page.tsx` and `/dashboard/talent/events/page.tsx` (the old dedicated talent explore page) now redirect to `/`, which is the sole home/explore surface for talent. `getDashboardPath()` (used by login/signup/onboarding-completion/OAuth callback) now sends talent to `/` instead of `/dashboard/talent/events`. The `/dashboard/talent/events/[id]` event-detail route, and the existing per-event redirect (`/events/[code]` → `/dashboard/talent/events/[code]` for an authenticated talent), are untouched.
- The header adapts to auth state: anonymous keeps today's Login/Sign up `Nav`. An authenticated talent sees `[cart, only if non-empty] [favorites heart] [avatar dropdown]` — no Login/Sign up, no top-level nav links. This same three-icon pattern replaces the desktop nav-links row in `TalentDashboardHeader` (used across `/dashboard/talent/*`), so the header is visually and behaviorally the same component wherever a talent sees it.
- Favorites is no longer a nav link — it's a heart icon next to the avatar (desktop) and a bottom-nav tab (mobile, replacing the old Explore/Favorites/Orders tabs derived from `talentNavLinks`). Orders and Profile move into the avatar dropdown (`DashboardUserMenu` desktop / `BottomNavAccount` mobile), which gains a new "Orders" item (Profile already lives there). None of favorites/orders/profile's own routes change.

## Capabilities

### New Capabilities
- `unified-talent-home`: the merged public/authenticated-talent home at `/` (compact hero + paginated event search, no redirect-away for authenticated talent) and the adaptive, role-aware header (cart/favorites/avatar-dropdown) shared between `/` and the talent dashboard.

### Modified Capabilities
(none — no existing `openspec/specs/*` capability currently documents the landing page, the public `Nav`, or the talent dashboard header; this is new spec territory rather than a change to a documented one.)

## Impact

- **Rewritten**: `src/app/[lang]/page.tsx` (landing content).
- **Deleted**: `src/app/[lang]/featured-events.tsx`, `src/app/[lang]/top-events-actions.ts`, `test/unit/components/featured-events.test.tsx` (orphaned once `/` stops using them — confirmed no other caller).
- **New**: a shared talent-header-actions component (cart/favorites/avatar-dropdown), a favorites icon-button component (mirrors `CartLinkButton`'s reserved-slot pattern), a client hook to read the current user's active role (mirrors `useAuthUser`).
- **Modified**: `src/components/nav.tsx` (role-aware branch), `src/components/talent-dashboard-header.tsx` (drop `talentNavLinks`, adopt the shared header actions, trim `BottomNav` items), `src/components/dashboard-user-menu.tsx` + `src/components/bottom-nav-account.tsx` (new Orders item), `src/lib/auth/home-redirect.ts` (talent exemption), `src/app/[lang]/dashboard/talent/page.tsx`, `src/app/[lang]/dashboard/talent/events/page.tsx`, `src/app/[lang]/actions/roles.ts` (`getDashboardPath`).
- **i18n**: new strings for the compact hero and the favorites icon's accessible label; several `home.*` keys (`heroSubtitle`, `featuredEventsTitle`, `exploreAllEvents`, `howItWorks*`, `pillar*`, `cta*`, `statusAll/Upcoming/Completed` under `home`) become unused and are removed from `en.json`/`es.json` after confirming no other reader.
- **Tests**: `test/unit/lib/home-redirect.test.ts` updates its `TALENT` expectation; new/updated component tests for `Nav`'s talent branch, `TalentDashboardHeader`'s trimmed nav, the landing page composition, and the dropdown menus' new Orders item.
- **Not touched**: `/events` (public browse-all page, keeps serving as a separate shareable entry point), `/events/[shareCode]` and `/dashboard/talent/events/[id]` (event detail + its existing redirect), `/dashboard/talent/favorites|orders|profile` (routes and logic unchanged — only their entry point moves).
