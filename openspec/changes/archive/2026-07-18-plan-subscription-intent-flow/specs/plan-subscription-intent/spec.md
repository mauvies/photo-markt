## ADDED Requirements

### Requirement: Subscription rows are written only with the service-role client

The `subscriptions` table is system-managed: RLS is enabled with no policies for `anon`/`authenticated`. Any server code that reads or writes `subscriptions` in a mutation path (checkout creation, cancellation) MUST use the service-role (`supabaseAdmin`) client. The user's identity MUST still be established with the user-scoped client (`supabase.auth.getUser()`); only the `subscriptions` query is elevated. The system MUST NOT add an `authenticated`-role RLS policy to make user-scoped writes work.

#### Scenario: Checkout creation writes the incomplete row via service role
- **WHEN** an authenticated photographer with no existing subscription starts checkout
- **THEN** the initial `incomplete` subscription row is inserted with the service-role client and the action returns a Stripe checkout URL (never a `42501`/`checkout_failed` from RLS)

#### Scenario: User-scoped client cannot touch subscriptions
- **WHEN** an authenticated (non-service-role) client attempts to `INSERT` or `SELECT` on `subscriptions`
- **THEN** the database denies the insert (error `42501`) and returns zero rows on select — proving the write path must be service-role

### Requirement: Plan intent is validated server-side against a whitelist

A plan/period pair arriving from any untrusted source (query string, OAuth state cookie) MUST be validated server-side against `src/lib/plans.ts`: `plan` ∈ {`free`,`starter`,`pro`}, `period` ∈ {`monthly`,`yearly`} defaulting to `monthly`. An unrecognized plan MUST resolve to "no intent". The resume target derived from an intent MUST be an internal path only — never an arbitrary URL from user input.

#### Scenario: Unknown plan is rejected
- **WHEN** a plan value that is not a real plan id (e.g. `enterprise`, `//evil.com`) is parsed
- **THEN** the parser returns null (no intent) and no checkout is attempted

#### Scenario: Free intent lands on the overview with no row
- **WHEN** a validated intent has plan `free`
- **THEN** the resume path is the photographer overview and no subscription row is created

#### Scenario: Paid intent routes to the internal resume checkout path
- **WHEN** a validated intent has plan `starter` or `pro`
- **THEN** the resume path is the internal `/dashboard/photographer/billing/resume` route carrying the whitelisted plan and period

### Requirement: Chosen plan survives signup and onboarding

A logged-out user who picks a plan MUST arrive at the correct branch after authenticating, without being sent back to pricing to re-choose. A brand-new user (no role yet) MUST complete onboarding first with the intent preserved; an already-onboarded user MUST resume immediately.

#### Scenario: New paid user completes onboarding then resumes checkout
- **WHEN** a not-yet-onboarded user authenticates with a `starter`/`pro` intent
- **THEN** they are routed to `/onboarding/role` with the plan+period preserved, and after choosing the photographer role `completeOnboarding` redirects them to the resume checkout path

#### Scenario: Onboarded user resumes immediately
- **WHEN** an already-onboarded photographer authenticates with a paid intent
- **THEN** the callback redirects straight to the resume checkout path (no onboarding detour)

#### Scenario: Price is re-derived server-side
- **WHEN** the resume route creates the Stripe checkout
- **THEN** the Stripe price is resolved from `plans.ts`/env for the whitelisted plan+period, never from a client-supplied amount

### Requirement: Post-payment activation is webhook-only, and the return tolerates the gap

Reaching the Stripe `success_url` MUST NOT grant or activate a plan — activation happens exclusively in the Stripe webhook. After checkout the user MUST land on the dashboard overview in a success state that tolerates the delay until the webhook applies the subscription, instead of showing a stale "still Free" result. Abandoning checkout MUST return the user to a sensible surface with no partial subscription state.

#### Scenario: Success return shows a confirming state until the webhook lands
- **WHEN** the user completes Stripe checkout and returns to `/dashboard/photographer?checkout=success`
- **THEN** a banner shows "confirming your subscription…" and polls the current plan (read via service role) until it reflects the active paid plan, then shows success — without ever activating the plan itself

#### Scenario: Cancel returns to a sensible surface
- **WHEN** the user abandons checkout (`cancel_url`)
- **THEN** they land on the billing settings page with a cancelled notice and no active/partial subscription granted
