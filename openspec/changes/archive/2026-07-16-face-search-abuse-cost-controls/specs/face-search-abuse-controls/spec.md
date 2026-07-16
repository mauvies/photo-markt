## ADDED Requirements

### Requirement: Tiered atomic cost limiting on anonymous face search

The anonymous face-search operation (`searchFacesInEvent`) SHALL enforce three independent limits before making its billable AWS Rekognition call, so that no attacker — including one who rotates IPs — can drive an unbounded AWS bill:

1. A per-`(event, IP)` fixed-window **hourly** request throttle (the existing limiter).
2. A per-**event** fixed-window **daily** cost cap.
3. A **global** fixed-window **daily** cost cap (the circuit breaker).

Each counter SHALL be incremented **atomically in a single Postgres statement** (`INSERT ... ON CONFLICT DO UPDATE SET count = count + N RETURNING count`) — never read-then-check-then-write — so a concurrent burst of serverless invocations cannot undercount. All three caps SHALL be configurable via environment variables and MUST NOT be hardcoded.

#### Scenario: Global daily circuit breaker trips

- **WHEN** the global daily counter has already reached the configured global cap and another anonymous face search arrives
- **THEN** the operation SHALL NOT call AWS Rekognition
- **AND** it SHALL return a dignified "face search is temporarily unavailable" outcome (localized), not a raw error

#### Scenario: Per-event daily cap isolates one event

- **WHEN** one event has reached its per-event daily cap
- **THEN** face search on that event SHALL degrade to "temporarily unavailable"
- **AND** face search on a different event whose counters are below their caps SHALL still succeed

#### Scenario: Per-IP hourly throttle still applies

- **WHEN** the same `(event, IP)` exceeds the hourly request throttle
- **THEN** the operation SHALL be rejected with the existing rate-limit message before the per-event and global counters are consumed

#### Scenario: Concurrent burst does not undercount

- **WHEN** many face searches for the same counter key arrive concurrently
- **THEN** each SHALL receive a distinct, monotonically increasing post-increment count from the atomic RPC
- **AND** the number of requests that observe a count within the cap SHALL NOT exceed the cap

### Requirement: Increment before AWS, counting real AWS calls

The cost counters SHALL be incremented **before** the AWS call is issued, and the allow/deny decision SHALL use the count **returned** by the increment. The increment amount SHALL equal the real number of billable AWS calls the operation performs, expressed as a single named constant (`AWS_CALLS_PER_FACE_SEARCH`). The current implementation performs exactly one billable Rekognition operation (`SearchFacesByImage`), so the constant SHALL be `1`; if a second billable call is ever added, the constant is the single place that changes.

#### Scenario: Counter reflects AWS calls, not raw request count

- **WHEN** a face search successfully passes the throttle and cost caps
- **THEN** the per-event and global daily counters SHALL each increase by exactly `AWS_CALLS_PER_FACE_SEARCH`

#### Scenario: Counters are consumed only for AWS-bound requests

- **WHEN** a request is rejected by the per-`(event, IP)` hourly throttle, or its selfie fails validation, before reaching the AWS call
- **THEN** the per-event and global daily cost counters SHALL NOT be incremented for that request

#### Scenario: Increment gates the AWS call

- **WHEN** the per-event or global counter is already at its cap
- **THEN** the increment-and-check SHALL block the request and the AWS call SHALL NOT be reached

### Requirement: Fixed-window reset

Each counter SHALL reset when its fixed window rolls over — hourly for the throttle, daily for the cost caps — so that a cap reached in one window does not carry into the next.

#### Scenario: New day window is unaffected by the previous day

- **WHEN** the global (or per-event) daily counter reached its cap in a previous day-window
- **THEN** a face search in the current day-window SHALL be evaluated against a fresh counter and SHALL be allowed if under the cap

### Requirement: Global-cap 50% email alert

When the global daily counter first reaches 50% of the configured global cap within a day-window, the system SHALL send exactly one alert email (via Resend) reporting current usage, so operators learn of abuse — or the need to raise the cap — before the breaker trips. The alert SHALL be deduped across concurrent serverless invocations using an atomic claim, firing at most once per day-window. When no alert recipient is configured, the alert SHALL be a safe no-op.

#### Scenario: Alert fires once when crossing 50%

- **WHEN** the global daily counter crosses 50% of the cap
- **THEN** a single alert email SHALL be sent
- **AND** subsequent face searches in the same day-window SHALL NOT send another alert

#### Scenario: No recipient configured

- **WHEN** the 50% threshold is crossed but no alert-recipient env var is set
- **THEN** no email SHALL be attempted and the face search SHALL proceed normally

### Requirement: Degradation isolates face search only

A tripped face-search breaker SHALL NOT affect bib-number search or any other part of the app (browsing, cart, checkout, photographer flows). Bib search runs on a separate path with no AWS call and its own limiter.

#### Scenario: Bib search unaffected when face-search breaker is open

- **WHEN** the global face-search breaker has tripped
- **THEN** bib-number search on the same event SHALL continue to return matches normally
