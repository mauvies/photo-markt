## ADDED Requirements

### Requirement: Role is written only by explicit user action

The system SHALL write `active_role` only in response to an explicit
user-initiated role switch (the role-switch menu or the role route). Rendering a
page or layout SHALL NOT write `active_role`.

#### Scenario: Rendering the photographer layout does not change role

- **WHEN** the photographer dashboard layout renders for a user whose `active_role` is `talent` (e.g. a background prefetch of a photographer route)
- **THEN** `active_role` remains `talent` and no write to `active_role` occurs

#### Scenario: Explicit switch persists

- **WHEN** the user invokes the role switch to talent
- **THEN** `active_role` is written to `talent` and subsequent talent actions are permitted

### Requirement: Talent permissions are gated by capability, not active view

The system SHALL gate talent-only actions (cart read/add/remove/clear, checkout)
and talent page access on whether the user holds the TALENT role, NOT on whether
`active_role` currently equals `talent`.

#### Scenario: Talent-capable user can use the cart regardless of view

- **WHEN** a user who holds the TALENT role performs a cart action while `active_role` is `photographer`
- **THEN** the action succeeds

#### Scenario: User without the talent role is blocked

- **WHEN** a user who does not hold the TALENT role attempts a talent cart action
- **THEN** the action is rejected

### Requirement: Layouts gate by capability

A dashboard layout SHALL render its own role's view and SHALL redirect a user who
does not hold that role to their own dashboard, without writing `active_role`.

#### Scenario: User lacking the role is redirected

- **WHEN** a user who does not hold the TALENT role navigates directly to the talent dashboard
- **THEN** they are redirected to their dashboard and no `active_role` write occurs

#### Scenario: User without any role goes to onboarding

- **WHEN** a user with no chosen role reaches a dashboard layout
- **THEN** they are redirected to onboarding

### Requirement: No dead role storage

The system SHALL NOT persist the active role in any store that is never read back.
The `active_role` cookie that is written but never read SHALL be removed.

#### Scenario: Role route does not set an unused cookie

- **WHEN** the role route handler processes a valid role switch
- **THEN** it switches the role and returns success without setting an `active_role` cookie
