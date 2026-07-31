## ADDED Requirements

### Requirement: Cancelling schedules the end of the period, never immediate termination

A photographer on a paid plan SHALL be able to cancel their subscription from the app. Cancelling MUST
set `cancel_at_period_end` on the Stripe subscription and MUST NOT terminate it immediately, issue a
refund, delete the local `subscriptions` row, or revoke access before the paid period ends. The
photographer keeps their paid plan for the remainder of the period they already paid for and drops to
Free afterwards.

#### Scenario: Cancelling a paid subscription

- **WHEN** a photographer with an active `starter` or `pro` subscription confirms cancellation
- **THEN** the system calls Stripe with `cancel_at_period_end: true` for that subscription, issues no
  refund, and the photographer retains their paid plan and its limits until the period ends

#### Scenario: Nothing to cancel

- **WHEN** a cancellation is requested for a user with no subscription, no Stripe subscription id, or a
  subscription that is not in an active-equivalent status
- **THEN** the system makes no Stripe call and returns a stable `no_subscription` error code

#### Scenario: Cancelling twice is refused, not repeated

- **WHEN** a cancellation is requested for a subscription that already has a pending cancellation
- **THEN** the system makes no Stripe call and returns a stable `already_cancelled` error code

### Requirement: Subscription state is written only by the Stripe webhook

Stripe is the source of truth and the database follows. The cancel and reactivate Server Actions MUST
NOT write to the `subscriptions` table, and MUST NOT anticipate the state change locally. The
`customer.subscription.*` webhook handlers are the only writers of `cancel_at_period_end`, exactly as
they are today for `plan_id` and `status`. Those writes MUST continue to use the service-role client,
since `subscriptions` is RLS-enabled with no policies.

#### Scenario: The cancel action touches no table

- **WHEN** `cancelSubscriptionAction` runs successfully
- **THEN** no query is issued against `subscriptions` other than the service-role read used to locate
  the Stripe subscription id, and in particular no INSERT or UPDATE is performed by the action

#### Scenario: The webhook persists the pending cancellation

- **WHEN** a `customer.subscription.updated` event arrives carrying `cancel_at_period_end: true`
- **THEN** the handler stores `cancel_at_period_end = true` on that user's `subscriptions` row using
  the service-role client

#### Scenario: A finished subscription is not left looking pending

- **WHEN** a `customer.subscription.deleted` event arrives
- **THEN** the handler sets `status = 'canceled'` **and** `cancel_at_period_end = false`, so a
  terminated subscription never reads as an unfulfilled pending cancellation

### Requirement: A pending cancellation is visible and reversible before it takes effect

While a cancellation is pending, the billing page SHALL show that the plan remains active until the
real Stripe period-end date and that the account moves to Free afterwards, and SHALL offer a way to
undo it. Reactivating MUST clear `cancel_at_period_end` in Stripe and MUST leave the subscription
otherwise unchanged — same plan, same period end, no new charge. A pending cancellation is defined as
the flag being set **while the status is still active-equivalent**; a row whose status is already
`canceled` is finished, not pending.

#### Scenario: Pending cancellation is shown with the real date

- **WHEN** a photographer whose subscription has `cancel_at_period_end = true` and an active status
  opens the billing settings page
- **THEN** the current-plan card states that the plan is active until the stored `current_period_end`
  date, formatted for the active locale, and that the account then moves to Free

#### Scenario: Reactivating before the period ends

- **WHEN** the photographer reactivates a pending cancellation
- **THEN** the system calls Stripe with `cancel_at_period_end: false`, no new charge is created, and
  once the webhook lands the subscription reads as a normal active subscription with the same plan and
  the same period end

#### Scenario: Reactivating something that was never cancelled

- **WHEN** reactivation is requested for a subscription with no pending cancellation
- **THEN** the system makes no Stripe call and returns a stable `not_cancelled` error code

#### Scenario: An expired cancellation is not offered for undo

- **WHEN** the subscription's status is already `canceled`, even if the flag is still set
- **THEN** the state is not treated as a pending cancellation and no reactivate affordance is shown

### Requirement: Cancellation is offered only on paid plans, behind exactly one clear confirmation

The cancel affordance SHALL appear only when the photographer's current plan is a paid plan; on Free
there SHALL be nothing to cancel. Cancelling SHALL require exactly one confirmation, which MUST state
the plan being cancelled, the real period-end date, and that the account moves to Free afterwards.
The confirmation MUST NOT use retention dark patterns — no multi-step maze, no hidden exit. Every
string it renders MUST exist in both dictionaries.

#### Scenario: Free plan has no cancel affordance

- **WHEN** a photographer on the Free plan opens the billing settings page
- **THEN** no cancel or reactivate action is rendered

#### Scenario: One confirmation, stating the consequences

- **WHEN** a photographer on a paid plan activates the cancel affordance
- **THEN** a single confirmation appears naming the plan, the real period-end date and the move to
  Free, and cancellation happens only after they confirm

#### Scenario: Missing period-end date degrades honestly

- **WHEN** the stored subscription has no `current_period_end`
- **THEN** the confirmation and the pending-state notice render a dateless variant of the copy rather
  than an empty or malformed date

### Requirement: The downgrade is contention, never destruction, and is disclosed when it will bite

Dropping to Free MUST NOT delete photos or events. Free's limits are enforced only at write time, so
a photographer over the Free limits keeps everything they have and is merely blocked from adding
more. When the photographer's current usage already exceeds a Free limit, the cancellation
confirmation SHALL disclose that consequence for each dimension that is exceeded; when usage is
within Free's limits, no such warning is shown.

#### Scenario: Over-limit photographer is warned before cancelling

- **WHEN** a photographer whose storage usage or event count already exceeds the Free plan's limits
  opens the cancellation confirmation
- **THEN** the confirmation additionally states, for each exceeded dimension, that they keep what they
  have but will not be able to upload more photos or create more events until they are back under the
  limit

#### Scenario: Within-limit photographer gets no warning

- **WHEN** the photographer's usage is within the Free plan's storage and event limits
- **THEN** the confirmation shows no over-limit warning

#### Scenario: Downgrade destroys nothing

- **WHEN** a subscription reaches the end of its period and the account falls back to Free
- **THEN** every photo and event the photographer owns still exists and remains accessible; only
  further uploads and event creation are gated

### Requirement: Changing plan clears a pending cancellation

Choosing a different paid plan is an affirmative act to keep paying. When a plan change is applied
in place to a subscription that has a pending cancellation, the system MUST clear
`cancel_at_period_end` in the same Stripe update. A photographer MUST NOT end up on a newly chosen
plan that still carries a cancellation inherited from the previous one.

#### Scenario: Plan change on a cancelled subscription

- **WHEN** a photographer with a pending cancellation switches to another paid plan
- **THEN** the in-place Stripe subscription update sets both the new price and
  `cancel_at_period_end: false`, and once the webhook lands the row shows the new plan with no pending
  cancellation

### Requirement: Every plan-dependent read reflects the change once it lands

A subscription state change MUST NOT be masked by a cached plan read. Any cached surface that resolves
the photographer's plan MUST be invalidated when the webhook writes a subscription state change, so
that commission rates, plan limits and plan-gated features recalculate rather than serving the
pre-change plan until a cache TTL expires.

#### Scenario: Downgrade is not served from cache

- **WHEN** the webhook writes a subscription state change for a photographer whose dashboard plan read
  is cached
- **THEN** the cache entry covering that plan read is invalidated as part of handling the event, so
  the next request resolves the plan from the database

#### Scenario: Commission and limits follow the resolved plan

- **WHEN** the account has fallen back to Free after the period ended
- **THEN** the commission rate, the storage and event limits, and plan-gated features all resolve from
  the Free plan, with no surface still reporting the previous paid plan

### Requirement: Domain failures return stable codes rather than thrown prose

Cancel and reactivate MUST report expected failures as stable, machine-readable codes returned from
the Server Action, not as thrown error messages, because thrown Server Action messages are redacted in
production. Call sites map those codes to localized copy. Unauthenticated access remains a thrown
error, since it signals tampering rather than a domain outcome.

#### Scenario: A Stripe failure surfaces as a translatable code

- **WHEN** the Stripe call fails while cancelling or reactivating
- **THEN** the action returns a stable error code and the UI shows localized copy for it, rather than
  a redacted generic server error

#### Scenario: Unauthenticated caller is rejected

- **WHEN** an unauthenticated caller invokes cancel or reactivate
- **THEN** the action throws and performs no Stripe call and no database write
