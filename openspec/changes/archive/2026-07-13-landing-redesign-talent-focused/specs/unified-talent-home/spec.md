## ADDED Requirements

### Requirement: The public home is a compact, talent-focused search experience
The home page (`/`) SHALL render, top to bottom: a compact hero containing only the page title (no descriptive subtitle, and not occupying the full viewport height), the existing event search bar, the existing paginated event grid ("Load more"), and the footer. It SHALL NOT render pricing, a "How It Works" section, or a final call-to-action section.

#### Scenario: Anonymous visitor sees the compact, search-focused home
- **WHEN** an anonymous visitor loads `/`
- **THEN** they see a hero with only the title (no subtitle) that does not fill the viewport
- **AND** the event search bar is visible below the hero
- **AND** all events are listed below the search bar with a "Load more" control, not just a top-events teaser
- **AND** no pricing section, "How It Works" section, or final CTA section is rendered

#### Scenario: Events load paginated, not all at once
- **WHEN** the home page's event grid is rendered
- **THEN** it uses the same paginated "Load more" grid the public `/events` page uses
- **AND** it does not render the previous top-events-only teaser

### Requirement: An authenticated talent's home is `/`, with no redirect away
An authenticated user whose active role is talent SHALL remain on `/` when visiting it — the server SHALL NOT redirect them to a dashboard route. This does not change behavior for an authenticated photographer (still redirected to their dashboard) or for an authenticated user who has not yet chosen a role (still redirected toward onboarding).

#### Scenario: Authenticated talent visits `/` and stays
- **WHEN** an authenticated user whose active role is talent requests `/`
- **THEN** the response is the home page itself, not a redirect
- **AND** the page's header reflects their authenticated, talent state

#### Scenario: Authenticated photographer is unaffected
- **WHEN** an authenticated user whose active role is photographer requests `/`
- **THEN** they are redirected to `/dashboard/photographer`, as before this change

#### Scenario: Not-yet-onboarded user is unaffected
- **WHEN** an authenticated user with no chosen role (no profile row, or a profile with no role membership) requests `/`
- **THEN** they are redirected toward the talent dashboard entry point, which routes them to onboarding, exactly as before this change

### Requirement: `/dashboard/talent` and the old dedicated explore page both resolve to the unified home
Visiting `/dashboard/talent` or `/dashboard/talent/events` SHALL redirect to `/`, which is the sole explore/home surface for talent. This does not change `/dashboard/talent/events/[id]` (event detail) or any other `/dashboard/talent/*` route.

#### Scenario: Visiting the old talent dashboard root redirects to the unified home
- **WHEN** an authenticated talent navigates to `/dashboard/talent`
- **THEN** they are redirected to `/`

#### Scenario: Visiting the old dedicated explore page redirects to the unified home
- **WHEN** an authenticated talent navigates to `/dashboard/talent/events`
- **THEN** they are redirected to `/`

#### Scenario: Post-login/signup/onboarding lands a talent on the unified home
- **WHEN** a talent completes login, signup, or onboarding
- **THEN** their landing destination resolves to `/`, not `/dashboard/talent/events`

### Requirement: The header adapts to authentication and role, with one shared pattern for authenticated talent
The site header SHALL show Login/Sign up for anonymous visitors (unchanged). For an authenticated talent, it SHALL show, in order: a cart icon (only when the cart holds at least one item), a favorites icon, and an avatar that opens an account dropdown — with no Login/Sign up controls and no top-level navigation links (Explore/Favorites/Orders/Profile). This same pattern SHALL be used both on `/` and within the talent dashboard's own header, so an authenticated talent sees a consistent header wherever they browse.

#### Scenario: Anonymous header is unchanged
- **WHEN** an anonymous visitor views the header on any public page
- **THEN** they see Login and Sign up controls, as before this change

#### Scenario: Authenticated talent sees cart + favorites + avatar, no nav links
- **WHEN** an authenticated talent with a non-empty cart views the header (on `/` or within `/dashboard/talent/*`)
- **THEN** they see a cart icon, then a favorites icon, then their avatar, in that order
- **AND** they do not see Login/Sign up
- **AND** they do not see top-level Explore/Favorites/Orders/Profile navigation links

#### Scenario: Cart icon hides when the cart is empty
- **WHEN** an authenticated talent's cart holds zero items
- **THEN** the header shows no cart icon (the favorites icon and avatar remain)

#### Scenario: Photographer header is unaffected
- **WHEN** an authenticated photographer views the header
- **THEN** their header behavior is unchanged by this requirement

### Requirement: Favorites, Orders, and Profile are reachable without top-level nav links
Favorites SHALL be reachable via a dedicated favorites icon in the header (desktop) or a dedicated tab in the mobile bottom navigation (within `/dashboard/talent/*`) — not a text nav link. Orders and Profile SHALL be reachable via the avatar's account dropdown (desktop `DashboardUserMenu`, mobile `BottomNavAccount`). None of these pages' own routes or behavior change.

#### Scenario: Favorites icon links to the existing favorites page
- **WHEN** an authenticated talent activates the header's favorites icon
- **THEN** they are taken to `/dashboard/talent/favorites`, unchanged from before this change

#### Scenario: Orders is reachable from the avatar dropdown
- **WHEN** an authenticated talent opens the avatar's account dropdown (desktop or mobile)
- **THEN** an "Orders" item is present and links to `/dashboard/talent/orders`, unchanged from before this change

#### Scenario: Profile remains reachable from the avatar dropdown
- **WHEN** an authenticated talent opens the avatar's account dropdown (desktop or mobile)
- **THEN** a "Profile" item is present, as before this change
