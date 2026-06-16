## ADDED Requirements

### Requirement: User chooses a username during the role-selection step

The onboarding role-selection step SHALL let the user enter a username together with their role. The username SHALL be persisted to `profiles.username` exactly as the user chose it (after normalization), and SHALL NOT be overwritten by any email-derived fallback.

#### Scenario: New user with no existing profile persists chosen username
- **WHEN** an authenticated user without an existing profile row submits the role step with role `talent` and username `surfer_jane`
- **THEN** the profile is created with `active_role = TALENT` and `username = surfer_jane`
- **AND** the email-derived username generator is NOT used

#### Scenario: Existing profile keeps the newly chosen username
- **WHEN** a user whose profile already exists submits the role step with username `new_handle`
- **THEN** the profile's `username` is updated to `new_handle`

### Requirement: Username normalization and format validation

The system SHALL normalize the submitted username to lowercase and strip characters outside `[a-z0-9_-]`, and SHALL reject usernames that are not 3–30 characters or do not match `^[a-z0-9_-]+$`.

#### Scenario: Invalid format is rejected with a localized message
- **WHEN** the user submits a username shorter than 3 characters (after normalization)
- **THEN** onboarding is not completed
- **AND** the user is returned to the role step with a localized validation message visible on the page

#### Scenario: Mixed-case and spaces are normalized
- **WHEN** the user submits `Surfer Jane!`
- **THEN** the value is normalized to `surferjane` before validation and persistence

### Requirement: Username uniqueness is enforced with a friendly error

The system SHALL verify the chosen username is not already taken by another user before persisting, and SHALL surface a localized "username already taken" message instead of raising an unhandled database error.

#### Scenario: Taken username shows a friendly error
- **WHEN** the user submits a username already owned by a different user
- **THEN** onboarding is not completed
- **AND** the user is returned to the role step with a localized "username already taken" message
- **AND** no unhandled database/unique-constraint error is thrown

#### Scenario: User keeps their own current username
- **WHEN** a user who already owns `jane_x` re-submits `jane_x`
- **THEN** the uniqueness check passes (a user does not collide with themselves)

### Requirement: Photographer slug mirrors the chosen username

When a photographer completes onboarding, the system SHALL ensure `profiles.slug` equals the chosen `username` so the public profile URL `/photographer/<username>` resolves immediately.

#### Scenario: Photographer public URL resolves after onboarding
- **WHEN** a user completes onboarding as `photographer` with username `studio_lopez`
- **THEN** `profiles.slug = studio_lopez`
- **AND** visiting `/photographer/studio_lopez` resolves to that profile

### Requirement: All onboarding strings are localized

The onboarding role/username UI SHALL render all visible text from the dictionary in the active locale, with matching keys present in both `en.json` and `es.json`. No visible string may be hardcoded.

#### Scenario: Spanish locale renders Spanish strings
- **WHEN** the onboarding step is rendered with locale `es`
- **THEN** the role card titles, username label, helper text, and validation/error messages display in Spanish

### Requirement: Real-time username availability feedback

The system SHALL provide a server action that reports whether a candidate username is available, so the UI can give feedback before submission. The check SHALL apply the same normalization and format rules and SHALL treat the current user's own username as available.

#### Scenario: Available username reports free
- **WHEN** the UI queries availability for an unused, valid username
- **THEN** the action reports it as available

#### Scenario: Taken username reports unavailable
- **WHEN** the UI queries availability for a username owned by another user
- **THEN** the action reports it as unavailable

### Requirement: A valid, available username is suggested by default

When the onboarding username field appears, the system SHALL pre-fill it with a suggested username derived from the user's Google display name, falling back to their email local-part when no usable name exists. The suggestion SHALL be normalized to the username format and SHALL be made unique/available (a numeric suffix is appended if the base is already taken) so the user can continue without typing. The user SHALL remain free to edit or replace the suggestion, and all existing format/uniqueness/availability rules SHALL apply to the value the user finally submits.

#### Scenario: Field is pre-filled from the display name
- **WHEN** a new user whose Google profile name is `Mauricio Viera` reaches the role step
- **THEN** the username field is pre-filled with a normalized suggestion such as `mauricioviera`
- **AND** the suggested value is valid and currently available

#### Scenario: Suggestion falls back to the email when no name is available
- **WHEN** a new user with no usable display name reaches the role step
- **THEN** the username field is pre-filled with a suggestion derived from their email local-part

#### Scenario: Suggested value is guaranteed available
- **WHEN** the derived base username is already taken by another user
- **THEN** the suggestion appends a numeric suffix (e.g. `mauricioviera_1`) until it is available

#### Scenario: User can override the suggestion
- **WHEN** the user clears or edits the pre-filled username and submits a different valid value
- **THEN** the submitted value is persisted (the suggestion does not override the user's choice)
