## ADDED Requirements

### Requirement: Auto-assigned per-event photo sequence

Every photo inserted for an event SHALL receive a stable integer `sequence`, unique-by-intent and increasing within that event, assigned automatically at insert time for both photographer (owner) and guest collaborative uploads. The sequence is never reused; deleting a photo leaves a gap.

#### Scenario: First photo in an event
- **WHEN** the first photo is uploaded to an event
- **THEN** its `sequence` is `1`

#### Scenario: Subsequent uploads increment
- **WHEN** a photo is uploaded to an event that already has photos
- **THEN** its `sequence` is `max(existing sequence for that event) + 1`

#### Scenario: Guest collaborative upload
- **WHEN** a guest uploads a photo to a collaborative event
- **THEN** its `sequence` is assigned by the same rule as owner uploads

#### Scenario: Deletion leaves a gap
- **WHEN** a photo with a given sequence is deleted
- **THEN** existing photos keep their sequence and future uploads do not reuse the deleted number

#### Scenario: Existing photos are backfilled
- **WHEN** the migration runs
- **THEN** existing photos in each event receive sequences ordered by `created_at`

### Requirement: Photographer-editable photo label

A photographer SHALL be able to set, change, or clear an optional free-text `label` on a photo of their own event. The displayed photo code is the `label` when set, otherwise the sequence number. The label is not required to be unique within the event.

#### Scenario: Override the auto code
- **WHEN** the photographer sets a label on a photo
- **THEN** the photo's displayed code is the label text instead of the sequence number

#### Scenario: Clear the label
- **WHEN** the photographer submits an empty label
- **THEN** the label is stored as null and the displayed code falls back to the sequence number

#### Scenario: Label is validated
- **WHEN** a label is submitted
- **THEN** it is trimmed and rejected if longer than 50 characters

#### Scenario: Only the owner can edit
- **WHEN** a user who does not own the event attempts to update a photo's label
- **THEN** the update is rejected and no change is made

### Requirement: Photographer-only visibility

The photo code (sequence and label) SHALL be shown and editable only in the photographer's own event album, and SHALL NOT be exposed in talent, buyer, or public event views.

#### Scenario: Visible in the photographer album
- **WHEN** the photographer opens their event album
- **THEN** each photo shows its code (label or sequence) and offers an edit affordance

#### Scenario: Hidden from talent and public
- **WHEN** a talent or public visitor views the event gallery
- **THEN** no photo code or label is shown
