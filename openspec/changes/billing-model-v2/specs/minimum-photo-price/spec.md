## ADDED Requirements

### Requirement: Priced photos must meet a configurable minimum price

When a photographer sets a non-null, non-zero `price_per_photo` on event create or edit, the value MUST be at least `MIN_PHOTO_PRICE_CENTS` (a validated env var, provisional €1.50). The floor is enforced at write time in the event create and edit actions/schemas — not as a database constraint — so the fixed service fee is never disproportionate to the item. A free event (`price_per_photo` null or 0) is exempt. Setting `MIN_PHOTO_PRICE_CENTS=0` disables the floor.

#### Scenario: A priced photo below the floor is rejected at create
- **WHEN** a photographer creates an event with `price_per_photo` = €0.50 and the floor is €1.50
- **THEN** the create action rejects it with a localized validation error and no event/photo is priced below the floor

#### Scenario: A price at or above the floor is accepted
- **WHEN** a photographer sets `price_per_photo` = €1.50 (or higher) with the floor at €1.50
- **THEN** the value is accepted

#### Scenario: Free events are exempt
- **WHEN** a photographer sets `price_per_photo` to null or 0 (a free event)
- **THEN** the floor does not apply and the event is accepted

#### Scenario: Existing sub-floor events are untouched until edited
- **WHEN** an event priced below the floor before this change is loaded but not re-saved
- **THEN** it is not retroactively rejected; the floor applies only when its price is next written

#### Scenario: The floor can be disabled
- **WHEN** `MIN_PHOTO_PRICE_CENTS=0`
- **THEN** any positive price is accepted (no minimum enforced)
