# minimum-photo-price Specification

## Purpose

Keep the fixed component of the buyer service fee from being disproportionate to the item being sold. A configurable floor on a priced event's `price_per_photo` is enforced at write time in the event create and edit actions — not as a database constraint — so events priced below a later-raised floor keep working until their price is next written. Free events are exempt and a floor of 0 disables the rule.

## Requirements

### Requirement: Priced photos must meet a configurable minimum price

When a photographer sets a non-null, non-zero `price_per_photo` on event create or edit, the value MUST be at least `MIN_PHOTO_PRICE_CENTS` (a named constant in `src/lib/plans.ts`, shipping at 0 and provisionally targeted at €1.50 — see the buyer-service-fee spec for why these are constants rather than env vars). The floor is enforced at write time in the event create and edit actions/schemas — not as a database constraint — so the fixed service fee is never disproportionate to the item. A free event (`price_per_photo` null or 0) is exempt. Setting `MIN_PHOTO_PRICE_CENTS=0` disables the floor.

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
- **WHEN** `MIN_PHOTO_PRICE_CENTS` is 0
- **THEN** any positive price is accepted (no minimum enforced)
