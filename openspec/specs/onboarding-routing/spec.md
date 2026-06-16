# onboarding-routing Specification

## Purpose

Defines how authenticated users are routed between onboarding and dashboards based on whether they have chosen a role, ensuring roleless users always reach the role/username onboarding step and that resolving a role for display never has a write side effect.

## Requirements

### Requirement: Roleless authenticated users are routed to onboarding

After authentication, a user who has not yet chosen a role (no profile row, or a profile with no role membership) SHALL be routed to the role/username onboarding step (`/onboarding/role`) on every primary entry path — OAuth callback, email-confirmation callback, and password login. No entry path may send such a user straight to a dashboard.

#### Scenario: OAuth/email-confirmation callback sends a new user to onboarding
- **WHEN** an authenticated user with no chosen role completes the `/auth/callback` flow without a `next`/`plan`/`token` redirect
- **THEN** they are redirected to `/onboarding/role`
- **AND** they are NOT redirected to `/dashboard` or any role dashboard

#### Scenario: Password login already routes a new user to onboarding (parity)
- **WHEN** an authenticated user with no chosen role logs in via the login page without a `next` redirect
- **THEN** they are redirected to `/onboarding/role`
- **AND** the callback path behaves identically for the equivalent user

#### Scenario: Onboarded users are unaffected
- **WHEN** an authenticated user who already has a role completes any entry path
- **THEN** they are routed to their role's dashboard as before

### Requirement: Resolving a role for display has no write side effect

Resolving the current user's active role for routing or display SHALL be a pure read: it MUST NOT create, update, or upsert a profile row, and MUST NOT generate a username from the user's email. Profile creation SHALL occur only on explicit write paths (completing onboarding, switching/enabling a role).

#### Scenario: Reading the role of a user with no profile does not create one
- **WHEN** the active role is resolved for an authenticated user who has no profile row
- **THEN** no profile row is created
- **AND** no email-derived username is generated
- **AND** the resolver reports that the user has not chosen a role

#### Scenario: Reading the role of an onboarded user returns their role unchanged
- **WHEN** the active role is resolved for a user who already has a profile
- **THEN** their stored `active_role` is returned
- **AND** the profile row is not modified

### Requirement: Dashboard entry gates roleless users to onboarding

A dashboard route (`/dashboard`, `/dashboard/photographer`, `/dashboard/talent`) reached by an authenticated user who has not chosen a role SHALL redirect them to `/onboarding/role` instead of minting a default profile.

#### Scenario: Roleless user hitting a dashboard route is redirected, not defaulted
- **WHEN** an authenticated user with no profile navigates directly to a dashboard route
- **THEN** they are redirected to `/onboarding/role`
- **AND** no profile with a default `PHOTOGRAPHER` role and email-derived username is created

#### Scenario: User who completed onboarding reaches their dashboard
- **WHEN** an authenticated user who has chosen a role navigates to a dashboard route
- **THEN** they see their dashboard without being redirected to onboarding

### Requirement: Chosen username and role survive end-to-end

A user completing onboarding through a primary auth path SHALL have the role and username they chose persisted — the email-derived fallback MUST NOT pre-empt their choice by being written before they reach the onboarding step.

#### Scenario: New OAuth user keeps the username they choose at onboarding
- **WHEN** a brand-new user signs in, is routed to `/onboarding/role`, and submits role `photographer` with username `studio_lopez`
- **THEN** the persisted profile has `username = studio_lopez` and `active_role = PHOTOGRAPHER`
- **AND** no intermediate profile with an email-derived username was created before onboarding completed
