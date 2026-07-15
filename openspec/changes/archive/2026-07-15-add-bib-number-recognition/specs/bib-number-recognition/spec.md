# Spec: bib-number-recognition

## ADDED Requirements

### Requirement: Per-event opt-in for bib detection
The system SHALL let an event's photographer enable or disable bib-number detection on a per-event basis, defaulting to disabled. Detection SHALL run only for events where it is enabled.

#### Scenario: Enabling detection on an event
- **WHEN** the event owner enables bib detection on an event
- **THEN** the event's `bib_detection_enabled` flag is set true and subsequent photo uploads on that event are queued for detection

#### Scenario: Detection is skipped for non-opted-in events
- **WHEN** a photo is uploaded to an event with `bib_detection_enabled = false`
- **THEN** no `DetectText` call is made for that photo and its `bib_detection_status` is `not_applicable`

#### Scenario: Only the event owner may toggle the flag
- **WHEN** a user who is not the event owner attempts to enable/disable bib detection
- **THEN** the action is rejected and the flag is unchanged

### Requirement: Bib detection background job
The system SHALL detect bib numbers in an opted-in event's photos using AWS Rekognition `DetectText`, run as an Inngest background job off the existing `photo.uploaded` event, independently of and in parallel with face indexing and thumbnail generation. Image bytes SHALL NOT cross Inngest step boundaries, and every AWS/Storage/Sharp call SHALL be wrapped with `safeCall`.

#### Scenario: Detecting bibs on an opted-in photo
- **WHEN** a photo is uploaded to an event with bib detection enabled
- **THEN** the job downloads the image, calls `DetectText`, and the photo's `bib_detection_status` becomes `detected` (or `no_bibs` when none pass the filter)

#### Scenario: Transient AWS failure
- **WHEN** the `DetectText` call fails after the job's configured retries
- **THEN** the photo's `bib_detection_status` is set to `failed` and no partial bib rows are persisted for it

#### Scenario: Bytes never leak into step output
- **WHEN** the detection job runs
- **THEN** no raw image buffer (or its base64) is returned from any Inngest step or surfaced in any error payload

### Requirement: Filtering DetectText output to plausible bibs
The system SHALL filter raw `DetectText` results down to plausible bib tokens before persistence: enforce a configurable confidence threshold, restrict to digit-dominant short tokens via a configurable pattern, and dedupe identical tokens per photo. Arbitrary non-bib text (sponsor banners, signage) SHALL NOT be persisted as bibs.

#### Scenario: Sponsor text is discarded
- **WHEN** `DetectText` returns "ACME", "FINISH", and "1432"
- **THEN** only "1432" is persisted as a bib (the others fail the digit-dominant/pattern filter)

#### Scenario: Low-confidence detection is discarded
- **WHEN** a candidate token's detection confidence is below the configured threshold
- **THEN** it is not persisted

#### Scenario: Duplicate tokens collapse
- **WHEN** the same bib token is detected multiple times in one photo
- **THEN** it is persisted once for that photo

### Requirement: Persistence of detected bibs
The system SHALL persist each detected bib per photo with its text, detection confidence, and bounding box, uniquely keyed per `(photo_id, bib_text)`. The store SHALL be readable by the bib-search path and writable only by the service role.

#### Scenario: Detected bibs are stored
- **WHEN** the detection job confirms one or more plausible bibs for a photo
- **THEN** one row per distinct bib is written with `(photo_id, bib_text, confidence, bounding_box)`

### Requirement: Backfill on enable
The system SHALL, when bib detection is enabled on an event that already has photos, fan out detection over those existing photos.

#### Scenario: Enabling on a populated event
- **WHEN** the owner enables bib detection on an event that already has uploaded photos
- **THEN** each existing photo is queued for detection and gets a terminal `bib_detection_status`

### Requirement: Talent search by bib number
The system SHALL let talent search an event's gallery by bib number, returning only photos that have a matching detected bib. Search SHALL be available on events that have bib detection enabled, on the same gallery surface as face search.

#### Scenario: Searching a present bib
- **WHEN** a talent searches an opted-in event for bib "1432" and photos with that detected bib exist
- **THEN** the gallery filters to exactly those photos

#### Scenario: Searching a bib with no matches
- **WHEN** a talent searches for a bib with no matching photos
- **THEN** an empty result state is shown (no error)

#### Scenario: Search unavailable when detection is off
- **WHEN** an event does not have bib detection enabled
- **THEN** the bib-search input is not offered for that event

### Requirement: Plan availability
The bib-recognition feature SHALL be available on all three plans (Free, Starter, Pro), consistent with the advertised pricing copy; the per-event opt-in — not the plan tier — is the cost control. The "Coming soon" badge SHALL be removed from `freeFeature4` / `starterFeature4` / `proFeature4` only once the feature is shipped.

#### Scenario: Available regardless of plan
- **WHEN** an event owner on any plan opens an event's settings
- **THEN** the bib-detection opt-in is available to them

### Requirement: Privacy and minors handling
The system SHALL treat bib numbers as low-sensitivity, non-PII race identifiers and document their handling. It SHALL respect the existing `contains_minors` event signal consistently with face matching (no broader exposure of minors' photos than face search already permits).

#### Scenario: Minors event consistency
- **WHEN** an event is flagged `contains_minors`
- **THEN** bib search exposes its photos no more broadly than the event's existing face-search/visibility rules allow
