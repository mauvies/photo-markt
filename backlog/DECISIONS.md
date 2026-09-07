# DECISIONS — why the rules in `CLAUDE.md` exist

`CLAUDE.md` carries the **rules**: the invariants and prohibitions that must be loaded in every
session, because they are what stops a fixed bug from being reintroduced. This file carries the
**history**: what actually went wrong, what it cost, and which alternative was rejected and why.

Read a section here when you are about to touch that area — not before. Every entry is keyed by its
ticket id, so a `(T-249)` in `CLAUDE.md` is the anchor to search for here.

Two rules about this file:

- **A rule never lives only here.** If you find something in this file that is an actionable
  invariant, it belongs in `CLAUDE.md` too. This file explains; it does not govern.
- **`ARCHITECTURE.md` still owns the diagrams and the flows.** Where a decision is best explained by
  the flow it lives in (payout transfers, disputes), the long form is in `ARCHITECTURE.md` §4.3 and
  this file only records the incident.

## Index

- [1. Roles and auth](#1-roles-and-auth)
- [2. Query layer](#2-query-layer)
- [3. Events, pricing and bundles](#3-events-pricing-and-bundles)
- [4. Photos, uploads and previews](#4-photos-uploads-and-previews)
- [5. The money path: payouts, orders, clawbacks](#5-the-money-path-payouts-orders-clawbacks)
- [6. Subscriptions and the buyer fee](#6-subscriptions-and-the-buyer-fee)
- [7. Email](#7-email)
- [8. Reveal gate and AI search](#8-reveal-gate-and-ai-search)
- [9. Dead schema and dead routes](#9-dead-schema-and-dead-routes)
- [10. Security and infrastructure](#10-security-and-infrastructure)

---

## 1. Roles and auth

### T-061 / T-189 / T-234 — `active_role` is not a capability

`user_role_memberships` is the **capability**; `profiles.active_role` is only the **view
preference**. The two legitimately diverge — `active_role` can point at a role the user does not
hold — which is why both dashboard layouts filter on `heldRoles` from `getRoleContext()` and why a
T-061 regression test pins the divergence.

There is also an unrelated, **empty `user_roles` table**. No code reads it. It is a false lead that
costs a diagnosis every time someone finds it first.

Role actions return a typed `RoleActionResult` rather than throwing because **Next redacts thrown
Server Action messages in production** (the T-189 finding), so a `throw` cannot tell the user why
anything failed. Codes and copy: `src/lib/role-action-error.ts`.

Before **T-234** only the talent side had an "enable" path, so a talent user had *no route at all*
to become a photographer — while the account menu still offered them a switch that could only be
refused, silently, because both switchers swallowed the rejection in a bare `catch {}`. That is why
the menus now take `heldRoles` and render «Switch to X» vs «Become a photographer»: a menu that does
not know the user's capabilities can only offer promises the server has to break.

Gaining a role is safe by design — a role is a self-service capability, not a privilege tier (anyone
picks either at onboarding with no verification), and neither enable action touches `admin_users`.

### T-198 — the dashboard auth-guard race

Next renders a route's segments **in parallel**, so the login guard in `dashboard/layout.tsx` does
not stop a child layout or page from executing. A child that reacted to a missing session by
*throwing* (`getRoleContext`, `getProfileFields(supabase, '')`, `getDashboardData`, …) raced the
parent's `NEXT_REDIRECT` into `[lang]/error.tsx` — that race was the intermittent "Something went
wrong" screen on `/[lang]/dashboard/talent`. Redirecting instead of throwing makes the race
harmless: every competing outcome becomes a redirect.

---

## 2. Query layer

### T-235 — `.single()` / `.maybeSingle()` and the opaque `PGRST116`

PostgREST answers "0 rows" (`single`) and ">1 rows" (both) with the same opaque `PGRST116`,
*"Cannot coerce the result to a single JSON object"* — which then reaches the user as-is.

Two live bugs came from this in one day:

- `getEvent` used `.single().throwOnError()`, which re-threw **before** its own error-mapping branch
  and made the declared `Event | null` unreachable — killing the `if (!event)` guard in all eight
  callers, including the event page's fallback to the contributor view.
- `getUserRole` used `.maybeSingle()` on `user_role_memberships`, which holds **one row per role**,
  so it threw for dual-role users at the onboarding gate.

### T-239 — a PostgREST failure on a table that exists

A schema-cache error on `order_items` made a read fail on a healthy table. It is the reason the
money path treats "the read errored" and "the read returned nothing" as different outcomes
(see [T-262](#t-262--a-failed-read-is-not-an-absent-row)) — the failure class is not hypothetical.

---

## 3. Events, pricing and bundles

### T-106 / T-180 / T-219 — session times and the columns that did not survive

`session_time` is the **manual session start** the photographer types, for display only: naive local
time-of-day, unrelated to any camera time-sync. The time-sync idea left behind `time_offset` /
`time_sync_enabled`, dropped in T-219. `session_end_time` (T-180) is its mirror; when both are set
the UI shows a range via `formatSessionTimeRange`, and the app-level rule (`isValidSessionRange`) is
app-level because the column carries no constraint.

T-219 also dropped `organizer_fee_per_photo_cents` **and** the wizard field that wrote it: the
field's own copy promised organizers a cut of every contributor sale, and no money path ever applied
one. There is no organizer revenue split.

### T-203 — bundle ladders

A bundle is a **price, not a product**: the purchasable unit stays the photo and a sale still writes
one `order_items` row per photo, so every entitlement reader (ZIP route, talent library, orders
history, guest download token, sold-photo soft delete) was untouched — and a reveal-gated event has
no whole-event product to unlock.

The applicable rung is the one with the **greatest** `minQuantity ≤ quantity`. Picking the
*cheapest* applicable rung instead would shadow every rung above it and let a 20-photo buyer pay the
3-photo price.

Validation lives at write time rather than in a DB constraint. Totals must be strictly increasing
with threshold — without that the ladder collapses to one rung. The `MIN_PHOTO_PRICE_CENTS` floor
applies to the **rung total**, not per photo: the floor governs what is being bought, and for a
bundle that is the set.

**`bundle_all_photos_cents` is a ceiling, not another rung**, and that was deliberate. A rung needs a
threshold the photographer would have to derive (`ceil(cap / price_per_photo)`), and that derived
number **goes stale when the unit price changes**: a rung at "4+ for €20" silently stops applying if
the price drops to €4, since €20 is then no longer a discount, and nobody is told. A ceiling keeps
meaning what was typed — it engages exactly where `quantity × unit` would exceed it, so a buyer with
3 matches still pays per photo while one with 40 pays the flat price (which a threshold rung could
not express). Consequence to know: once a buyer reaches the cap, adding their remaining photos is
free — that is the Foto-Flat bargain, not a bug.

### T-212 — three submission states, and the kill switch that deleted data

**The price is not monotonic in quantity, and nothing enforces that it is.** An earlier version of
this note claimed otherwise. A rung below `(minQuantity − 1) × unit` prices a smaller set higher —
"3 for €9" at €5/photo charges €10 for two and €9 for three — and *that is what a volume discount
is*, since the flagship Foto-Flat shape ("40 for €19.90") drops from €195 to €19.90. Any rule strong
enough to forbid the first forbids the second. The buyer is protected by the `min` against singles,
not by monotonicity.

Collapsing the parse result into a single `null` was **silent data loss on a money column**: a
cleared amount box, a `1` typed into a threshold, or a stored ladder the reader rejects each DELETED
the photographer's pricing and reported success — and made `quantity_too_low` an unreachable
message. Hence `absent` / `cleared` / `invalid` as distinct outcomes, and hence
`buildEventUpdateFormData(parsed, { includeBundlePricing })`: only a form that renders the ladder
editor may send it. That is what stopped an unrelated save from wiping the ladder **and** stopped
lowering a price from throwing `total_not_a_discount` about a field the section cannot show.

Write paths gate on `eventAcceptsBundleConfig`, never `eventSupportsBundles`. The latter folds in
the kill switch, so flipping `BUNDLE_PRICING_ENABLED` for a rollback made the next save of any kind
erase every stored ladder permanently — the exact opposite of the property the switch advertises.
Rollback must be inert: stored ladders survive it unread, so rollback needs no migration. An
ineligible event likewise **keeps** its stored ladder; restoring a price restores the packs.

The READ parser still fails **closed** to "no ladder", which is right for a read (falling back to
`quantity × unit` can only overcharge vs. intent — visible and refundable — never undercharge) and
wrong for a write.

### T-204 — pricing a cart, not a set

Grouping is `(event, photographer)`, never the whole cart: a discount must not be funded by another
photographer's revenue, so a cart spanning two events discounts only the qualifying group. The pair
rather than event alone keeps organizer events (several sellers) a gate change away rather than a
redesign.

It **fails closed to list price** — the direction that can only overcharge vs. intent, never
undercharge — when the event is ineligible, has no schedule, has no `eventId`, or when a group's
lines disagree on the unit price (a price change between two adds makes `quantity × unit`
ill-defined).

The authenticated cart's **optimistic** re-price after a removal must call the same function; a
`reduce` there would leave a discount on screen that checkout will not honour.

**One surface quotes an event's price.** A configured schedule moves the whole price story to
`EventPricingSection` and `EventMetaLine` suppresses its price segment entirely — repeating the unit
price under the title is redundant, and on an event sold by the package it is the least relevant
number to lead with. `event-card.tsx` renders no price, so cards needed no change.

Ticket A of this work made the cap writable but never displayed it, so a configured Foto-Flat
reached no buyer — hence the cap row in `EventPricingSection`.

**"Add all my photos"** takes its ids from the viewer's own match set (`faceSearch.matchedPhotos`,
which on a reveal-gated event *is* the proven set the reveal token was minted over) and never a
fresh query for the event's photos. Breaking the gate is one call away and **both versions
compile**, which is why the id source is pinned by a test.

`cart_items.allocated_price_cents` is written **before** the Stripe session is created and the
webhook never recomputes a bundle price from the event's tiers: the ladder is editable at any
moment, and a recompute between the charge and a retried or late delivery would build an order that
disagrees with the buyer's card statement. Writing it clears every other row in the cart first, so a
5-photo bundle's allocation cannot survive into a later 2-photo checkout. Null means "no bundle
applied", so rollback needs no migration.

### T-134 — the public→private flip charge

`cart_items.access_share_code` persists the share code the buyer presented at add/merge time. Before
it existed, an event that was public when the photo was added and private at checkout was still
charged for. Never treat the display-only `event_share_code` (the event's *current* code, joined for
the `/events/[shareCode]` link) as the access proof.

### T-223 — the guest cart is shared state between tabs

`GuestCartProvider` read `localStorage` on mount and wrote on every change, but never listened for
`storage`. Two open tabs diverged: adding a photo in tab A never appeared in B, and B's next write
clobbered A's cart wholesale, because each tab serializes its own array over the one key. It is a real
shape for this product — buyers browse an event and open photos in new tabs.

Convergence is last-writer-wins on the key: the tab that receives the event adopts the value the event
carries, rather than merging. A merge would have to distinguish "not added here yet" from "removed
there", which the stored array cannot express. What the fix removes is the clobber — a tab that is
current cannot overwrite work it never saw.

Two details the listener has to get right: `event.key === null` is `localStorage.clear()` and carries no
`newValue`, so the key is re-read rather than assumed gone; and `hydrated` is never touched, or the empty
state flashes again (T-176).

`parseGuestCart` came out of the same change. The mount path used to `setItems(JSON.parse(stored))`
unguarded, so a non-array payload reached `items` and broke every consumer that maps over it.

### T-211 — who may set `watermark_enabled`

The rule had drifted into four hand-written copies and two disagreed: `updateEventAction` had lost
the organizer branch (any edit — even a rename — stripped an organizer event's watermark), and the
edit form had no copy at all, so a private event offered a switch the save silently discarded.

Organizer events are exempt from the private-event force-off because they are *always* private
(access is the membership join table), so without the carve-out none could ever be watermarked.

---

## 4. Photos, uploads and previews

### T-142 — soft-delete on sale

A photo that has been sold is never hard-deleted: the buyer keeps permanent access. The
`ON DELETE RESTRICT` FK on `order_items.photo_id` / `guest_order_items.photo_id` stays as a hard
fail-safe backstop.

The query invariant cuts **both** ways, and the second direction is the dangerous one: every
photographer/public/gallery/search/cart/cover/quota read must filter `deleted_at IS NULL` (a miss
resurfaces a deleted photo), while buyer-facing reads and the orphaned-storage-cleanup **in-use**
set must never add that filter — a stray filter there deletes a paying buyer's bytes.

### T-231 — `failed` is not `rejected`, and `pending` is not a resting place

`rejected` = the bytes were bad, so the worker deleted the storage object; nothing to recover, and
it does not count toward the per-event upload cap. `failed` = the run exhausted its retries **before
reaching a verdict**, so the bytes are still there and the photo is recoverable.

Leaving such a photo `pending` is the trap: that state is invisible on every surface (approved-only
galleries, and the Pending moderation tab excludes owner uploads) *and* the reconcile cron re-drives
it forever. Before T-231, branch (d) of `reconcileIndexingState` filtered on `upload_status='pending'`
alone, so an owner upload whose run had died was re-emitted every 30 minutes indefinitely.

`settleStrandedUploadStatus` no-ops when the status is already settled (a failure in steps 4–7 must
not degrade an approved photo) and when `pending` is the *legitimate* moderation queue (a
third-party upload on an approval-gated event).

Retry is rate-limited 20/h because each photo can trigger billable AWS work.

The owner page's grid total counts `['approved','pending']`, not `countEventPhotos` — the latter is
the upload-cap counter, where a `failed` photo's bytes still count.

### T-099 / T-183 — the three silent wedges

`reconcileIndexingState` exists because three states had no other recovery path: an event stuck in
`ai_matching_status='indexing'` forever (a lost `photo.uploaded` or a missed `maybe-mark-event-ready`
step), a thumbnail that never bakes (a swallowed best-effort `emit-processed`), and an owner upload
stranded `pending` — invisible on the approved-only galleries *and* absent from the owner's Pending
tab, so the dashboard count says N while only the approved subset renders.

Branch (d) re-emits `photo.uploaded` rather than flipping the row to `approved` here, so the
byte-validation gate is never skipped. The owner-upload predicate's column-to-column comparison is
applied in JS after an inner-join fetch, since PostgREST cannot express it.

### T-238 — Vercel's 4.5 MB body cap

Vercel caps a serverless function's request body at 4.5 MB and **the cap is not configurable**. A
larger body is refused by the platform with its own 413 (`FUNCTION_PAYLOAD_TOO_LARGE`) *before* Next
runs, so it reaches no `try/catch`, no toast and no dictionary: the user gets Vercel's raw error
page.

`next.config.ts`'s `serverActions.bodySizeLimit` is honoured **only in local dev**, which is exactly
what hid this: it read `'500mb'`, covers uploaded fine on localhost, and photographers in production
could not set one at all.

Covers moved to the direct-to-Storage pattern in the same ticket. The magic-byte validation moved
with them, it did not disappear: `attachEventCoverAction` downloads the stored object back, runs
`validatePhotoBuffer`, and deletes the object if it is not an image — the same shape as the Inngest
worker's `rejected` verdict for photos. It also refuses any path outside the caller's own
`${userId}/${eventId}/` prefix, since attach takes a client-supplied path.

The face-search selfie's old 10 MB limit could never work end to end anyway: Rekognition accepts at
most 5 MB of image bytes.

### T-131 / T-133 / T-136 / T-140 — preview protection

The watermark route picks the treatment **server-side** from the photo's event, never from the
caller, and only from a `photos` row whose `event_id` matches the path's event segment. Unknown
policy fails closed to the watermark treatment.

`needsProtectedPreview` reads `watermark_enabled`, so "simplifying" the private-event rule in
`watermark-policy.ts` would change how existing events' previews are served.

A **dedicated cover image** (T-055) is always direct-signed: it is a promotional presentation image,
not a for-sale photo — and it is not a `photos` row, so the watermark route could not resolve a
policy for it.

### T-182 — why `profiles.avatar_url` is authoritative

This app is Google-OAuth-only and GoTrue re-syncs `user_metadata.avatar_url` from the Google identity
on **every sign-in**, so a custom avatar written there reverts on next login. The durable render
path must never depend on it; the metadata write exists only so the public-site header (which reads
auth metadata via `useAuthUser`) reflects the change immediately.

Ordering discipline in the action: validate → throttle → read prior avatar/slug → upload →
authoritative `updateProfile` write (on failure, delete the just-uploaded object) → best-effort
metadata sync → delete-on-replace → revalidate. Validation runs before the throttle (a bad pick
costs no quota); the profile read runs before the upload (a read error cannot orphan a fresh
object).

`updateUserById` does **not** throw, so `syncAuthAvatarMetadata` checks the returned `{error}`.

Existing rows point at the full Google OAuth URL and are not migrated; the render layer only passes
the string as `src`, so both coexist.

---

## 5. The money path: payouts, orders, clawbacks

The long-form flow diagrams live in `ARCHITECTURE.md` §4.3. This section records the incidents.

### T-216 — one idempotency namespace, and the whole request body

Before T-216 the two writers (webhook, retry worker) had **separate idempotency namespaces**, so a
redelivery past Stripe's 24-hour window paid twice and the swallowed `23505` erased the evidence.

The row is created **before** the Stripe call and its id **is** the idempotency key
(`payout_<row.id>`). Reverse that order and the double-pay comes back.

The parameters must match too: Stripe compares the **whole request body** against the one stored
under a key and 400s on divergence. Taking `transfer_group` from the order id in one writer and
`payoutTransferGroup(row.id)` in the other wedged every `transfer_failed` retry for 24 hours —
looking exactly like a Stripe outage in the logs — and then double-paid once the key expired.

That ordering is what makes the partial unique index on `(stripe_charge_id, photographer_id)`
*prevent* a second payment rather than merely record one. `UNIQUE(stripe_transfer_id)` is gone
because one aggregated transfer settles N rows.

Three exits used to lose money with a `console.warn` — Connect not active, net < 50¢,
`createTransfer` threw. Each now opens a `pending` row with a `hold_reason`.

Only sub-50¢ rows are batched. Anything that clears the minimum alone transfers individually with
`source_transaction`, which both guarantees funding and lets Stripe refuse an over-draw — a
double-pay guard that never expires, unlike the 24h key. Batching drops `source_transaction` (Stripe
allows one source charge per transfer) and therefore draws on the *platform* balance; that is
tolerable only because those amounts are tiny.

The retry worker requires **both** `hold_reason` and `stripe_charge_id`. That is a security filter:
`pending` predates T-216 and an RLS policy used to let photographers INSERT their own rows, which a
paying worker would turn into theft. The INSERT and pending→cancelled UPDATE policies were dropped in
`20260807000000` for the same reason.

### T-220 — the admin payout endpoint

A status flip moves no money: the endpoint wrote a column and called no Stripe API, so its one
distinctive power was making the ledger claim a payment that never happened. Recoverable holds drain
via the retry worker, refunds void them, and cancelling one by hand makes it permanently unpayable
(the unique index then blocks a replacement row). It refused anything carrying a charge id, so it
never reached the stranded rows anyway.

### T-215 / T-237 — clawbacks and disputes

`charge.dispute.created` / `.closed` were handled by **no case at all** before T-215: a lost
chargeback pulled the money back, charged a ~€15 fee, and left the buyer with permanent download
access.

Because 13+ read paths already gate on `status = 'completed'`, flipping the order to `disputed`
revokes access everywhere with **zero reader changes** — and `won` sets it back. Restoring works
because the exactly-once index constrains INSERTs, not UPDATEs: the row never went away.

The **guest** side needed a new `getGuestOrderByPaymentIntentId`: the refund path only ever consulted
`orders`, so a refunded guest kept a working download-token page.

A lost dispute records the fee as a **platform** cost, never charged to the photographer — they
control neither the fraud nor the dispute. A won dispute un-voids exactly the holds THAT dispute froze, scoped
by `frozen_by_dispute_id`. Scoping on `void_reason = 'dispute'` alone was a bug: settling a chargeback by
refunding and then winning it resurrected the refund-voided hold and paid the photographer for a sale the
buyer got back in full.

**T-237:** voiding a hold outright on a *partial* refund destroyed the photographer's net on the
un-refunded part. An outstanding hold is reduced proportionally and voided only on a full reversal.

All the math is integer cents — a float ratio would leave a phantom cent on a fully reversed sale.

The reversal idempotency key is `(payout row, cumulative reversed amount)`, never
`(transfer, charge)`: that pair is constant across successive partial refunds, so the second one
would reuse the first's key and Stripe would return the first reversal — the photographer silently
keeping money the buyer got back.

### T-260 — read-modify-write on the ledger

`reservePayoutReversal` / `releasePayoutReversal` do their arithmetic in **one** SQL statement
(`reserve_payout_reversal` / `release_payout_reversal`, migration `20260828000000`, service-role
only). The caller's delta already comes from an earlier read of `reversed_amount_cents`, so a JS
`existing + delta` puts two reads around the arithmetic: `charge.refunded` racing
`charge.dispute.closed`-won recorded the delta **twice**.

Stripe stayed correct (the idempotency key encodes the cumulative target, so only one reversal
happens). The ledger did not, and permanently: `getTotalPaidOut` is net of reversals, so it
understates the balance forever and every later delta computes `target − already` = 0, silently
no-opping the next legitimate reversal. The `least`/`greatest` clamps live in SQL **because** that is
what keeps it one statement.

### T-259 — `completed` written by two flows

`mayWriteOrderStatus` gates the clawback flow, where the status is recomputed from Stripe's facts, so
`completed` may only undo a revocation this flow itself made. `mayPromoteOnPaymentSuccess` gates
`payment_intent.succeeded`, where `completed` means "the payment went through".

The second guard was missing: the handler promoted anything that merely was not `completed`. Stripe
redelivers for up to three days (and a dashboard resend is routine here since T-192), so a refund
landing between the first delivery and its retry let the retry flip the order back to `completed` —
restoring permanent ZIP + library access for a refunded buyer and putting the sale back in the
photographer's `net` while its payout row sat `cancelled`. The money was safe (the exactly-once index
blocks the re-drive); the access was not.

### T-265 — a freeze that outlives its dispute

Two `catch` blocks on the dispute path wrote to the console and nothing else, and the selector
exclusion in `listPayableHolds` made the first of them terminal.

A failed **unfreeze** is the expensive one: the row keeps `frozen_by_dispute_id`, every payout
selector refuses it, and `restoreHoldsForCharge` — reachable only from `charge.dispute.closed` — is
its only writer. The debt is real, recorded and permanently unpayable, and the photographer is still
shown a balance for it: an inquiry-frozen row stays `pending` and keeps counting in
`getTotalPendingPayouts`, while a chargeback-frozen row leaves `pending` just as the won dispute
returns the sale to their `net`. A failed **freeze** is the mirror: the row keeps its `hold_reason`
and charge id with no mark, so the retry cron pays a charge that is under dispute.

**Why the sweep asks Stripe, when T-264's sweep deliberately does not.** Two facts about the data
decide it, not a change of policy:

- A **lost** dispute leaves the row `cancelled` + `void_reason='dispute'` + `frozen_by_dispute_id`
  **forever** — the `lost` path never restores, and must not. That is byte-for-byte the same local
  state as "won, but the unfreeze failed". A purely local sweep would alert on every lost chargeback,
  every day, and bury the real ones.
- A chargeback legitimately stays open for 60–90 days, so an age-based local sweep could not call
  anything stale for three months. "Still open at Stripe" is a definitive non-alert, which is what
  lets the staleness window be six hours.

The question is also different in kind from T-264's. There it was "does this transfer exist?",
answered by a listing whose `has_more` makes `unknown` unavoidable; here it is
`disputes.retrieve(dp_x)` — by id, where a failed read is distinguishable from an answer. And the
repair moves no money at Stripe: `restoreHoldsForCharge` clears a mark, is idempotent, is scoped to
one dispute id, and hands the row back to the ordinary payout path with all its guards intact.

**Rejected:** having the `lost` branch clear the mark so a local sweep would be unambiguous. It
changes the webhook's money flow, it needs a new rule for what to do when the clawback itself failed
(clearing the mark there would make a lost dispute payable), and it does nothing about the 90-day
problem.

**What the review changed.** The first cut released a freeze with `restoreHoldsForCharge` alone.
Four independent reviewers found the same hole, and it is worth recording because the shape recurs:
**a chargeback freeze leaves the row `cancelled`, and both clawback selectors skip that status** —
`applyReversalToHolds` takes only `pending`, `listReversibleRowsForCharge` only
`paid`/`processing`/`reversed`. So a refund landing while the row is frozen records nothing on it
(`reversed_amount_cents` stays 0), and a later restore hands back the **full original amount** for a
sale the buyer got back — the exact loss the webhook's post-restore `applyClawback({reason:'refund'})`
exists to prevent, and which the sweep had silently dropped. Because the step runs before the paying
step, the money would go out in the same pass.

The fix is a refusal rather than a reconcile: the sweep declines to release any charge with refunds,
any charge it cannot read, and any row whose order is still `disputed` (paying there would break
"a hold sits in `pending` exactly while its sale sits in `net`", and pay for a sale the buyer cannot
access). That keeps the property that made the design defensible — **a cron never moves money** — at
the cost of leaving those cases to the daily alert.

The same review found that the selector never drained: a lost dispute keeps its mark forever, those
rows are never updated again, so under `updated_at ASC` they occupy the head of the row cap
permanently and eventually hide every genuinely stranded freeze — a row no selector picks up, which is
the precise failure this ticket exists to remove. Hence `clearDisputeFreezeMarks` on a confirmed-lost
dispute whose clawback is already recorded, plus an explicit per-pass bound on the Stripe reads with
the overflow named in the alert.

**Known gap, accepted.** A successful release logs rather than alerting — the failure that stranded
the row already alerted. So if `charge.dispute.closed` never arrives at all (the T-192 shape, where
the production endpoint 307-redirected and every delivery died), the sweep repairs silently and
nobody learns events are being dropped. The counts are assigned **outside** `step.run` (a counter
mutated inside it reads 0 after an Inngest replay), so the run result really does carry them; T-256 is
the ticket about that class of drift.

### T-249 — the invisible `continue`

The ledger's `try/catch` + `continue` is correct — a failure there must not throw, because a 500
makes Stripe redeliver a payment we may already have made — and that is exactly why it must alert:
the failure is invisible by construction unless something surfaces it.

It already cost a real sale: **2026-07-28, €0.99, `completed` with zero `payouts` rows, unnoticed for
thirteen days.**

Seven exits can complete an order without paying. Three are inside `createTransfersForOrderItems`;
four are *before* it and are the quieter ones, because they never open a row at all:

- `openPayoutRow` throws — no debt, no transfer, no trace.
- `createTransfer` throws **and** `holdPayoutRow` throws too, stranding the row `processing` with no
  `transfer_batch_id` — a state **neither** recovery selector picks up (`listPayableHolds` needs
  `pending` + a `hold_reason`, `listStaleProcessingBatches` needs a batch id), so the debt is real,
  recorded and permanently unpayable.
- the `order_items` read errors — this one used to discard its `error`, fall back to `[]`, and no-op
  the transfer loop on the empty list, logging *nothing whatsoever*. It is the best candidate for the
  2026-07-28 incident, and the failure class is not hypothetical: T-239 was a schema-cache error on
  this same table.
- the `order_items` read succeeds but returns nothing — a completed order with a non-zero total and
  no items is money charged for photos nobody will be paid for.
- an order item names a photographer with no resolvable `profiles` row: the transfer loop walks
  `connectStatuses` while the money lives in `totals`, so that share never reaches the loop.
- no `chargeId` on the payment intent (authenticated **and** guest), plus the guest path's catch-all,
  which is wider than the authenticated one since it also wraps the PaymentIntent retrieve, the
  Connect/plan lookups and the status reconcile.

The alert must **never** claim nothing was paid: `createTransfersForOrderItems` can throw part-way
through a multi-photographer cart *after* earlier photographers were transferred and settled, so an
operator acting on "nothing was paid" would pay them twice. It names the `payouts` rows as the
authority instead.

The reporter was **rescued from** the parked T-215/PR #290 branch rather than rewritten, so the two
cannot diverge. Only the **email** is throttled: Sentry groups by fingerprint, but email does not, and
one DB outage fires the catch once per photographer per order. The throttle is keyed per `kind` (a
payout alert must not silence a dispute alert — different incidents, not duplicates) and is released
when the send fails, so a transient Resend error cannot suppress the retry. It is bounded by 5 s
because it rides inside the webhook and a hung alert must not push the handler past Stripe's delivery
timeout.

The alert changes nothing about the flow: same `continue`, same 200.

### T-252 — Stripe does not guarantee event ordering

When only `payment_intent.succeeded` transferred, a delivery that beat `checkout.session.completed`
found no order (`getOrderByPaymentIntentId` → null), skipped the whole block and returned 200 — and
the authenticated `checkout.session.completed` then created a `completed` order **without ever
transferring**: buyer charged, photographer unpaid, zero `payouts` rows, not one log line. The same
shape as the 2026-07-28 incident, and one that T-249 by construction could not catch, since it alerts
the exits that *run*.

Both handlers now call the shared `drivePayoutsForOrder`; whichever arrives first pays, and the
second no-ops because `openPayoutRow` reserves the row before the Stripe call. **Re-driving is only
safe because of that ordering** — reverse it and this becomes a double-pay.

**Only the delivery that creates the order drives its payouts.** Re-driving on a redelivery whose
order already exists is not the free win it looks like: the unique index is partial
(`where stripe_charge_id is not null`), and every row written before T-216 has a null charge id (the
old `createPayoutFromTransfer` stored none), so resending an old session — routine here since the
T-192 backlog — would open a fresh row under a new idempotency key and **pay twice**. A refunded
order would transfer too (`charge.refunded` voids `pending` holds; it cannot un-send a transfer).

An authenticated session that is `unpaid` (delayed payment method) or `no_payment_required` skips the
drive and waits for `payment_intent.succeeded`. Any other or absent `payment_status` falls through
and *attempts* the transfer, because a premature attempt is refused by Stripe and parked as a
recoverable `transfer_failed` hold, while skipping it would be silence.

Every incident raised inside the shared drive carries `source`: a genuine failure alerts once per
delivery, from two serverless invocations no per-process throttle can dedupe, so the field is what
lets an operator tell a duplicate from a second loss on the same order.

The buyer's confirmation email moved *before* the money moves and is bounded at 5 s: Stripe treats a
slow response as a failed delivery, and an unbounded Resend could push the invocation past that
timeout and strand the transfers, since the redelivery stops at the guard.

A `payment_intent.succeeded` with no order is reported nowhere, on purpose: subscriptions (they carry
an `invoice`) and guest payments (they live in `guest_orders`) legitimately have no `orders` row, and
the out-of-order case is now covered by the other handler. Alerting on all three would bury the
signal the money incidents exist to carry.

### T-261 — a guest order born `completed`

`createGuestOrder` used to write `completed` before the items and the download token existed — and
both of those writes throw. The throw became a 500, Stripe redelivered, and the redelivery returned
early at "guest order already exists", so the transfer block ran on **neither** delivery: buyer
charged, no items, no token, no `payouts` row, not one log line, and no recovery path
(`payment_intent.succeeded` reads `orders` only).

Now `pending` means "delivery unfinished", the redelivery resumes the same row (guarded by
`guestOrderHasItems`, so items are written once), and the failure reports before rethrowing — the
rethrow is *wanted*, because the 500 is what triggers the retry that fixes it. Tidying the guard back
to `if (existingGuestOrder)`, or making the assembly non-throwing, each alone re-creates the silent
loss.

### T-262 — a failed read is not an absent row

`createAuthenticatedOrder` used to discard the `carts` error in the destructuring
(`const { data: cart } = …`) and lump `cartItemsError` in with "cart is empty" — so a transient
PostgREST failure (T-239 was exactly that, on `order_items`) was indistinguishable from "no such
cart": both logged, returned `null`, and answered **200**. Buyer charged, no order, no items, no
email, no payout row, no incident.

Now a read error alerts and **throws** (the 500 is the retry), while a genuinely missing row alerts
and gives up (retrying cannot bring it back). Assembly — `addOrderItems` + `clearCart` — is wrapped
the same way, because a throw there used to leave an order with no items **and a cart that was never
emptied**, so the buyer saw an empty purchase and could pay for the same photos again.

This narrows the exists-guard by exactly one case, and the narrowing is what keeps T-252's paragraph
true: an order with no `order_items` was never assembled, so it has no payout rows to pay twice and
re-driving it can resend nothing. Everything that paragraph is actually about (an old resent session,
a refunded one) is fully assembled and still stops. The distinction is `orderHasItems`, never
`existingOrder.status` — the row is written `completed` from the start, so status says nothing about
whether delivery finished.

### T-263 — `completeGuestOrder` runs last

`completed` is what stops a redelivery from resuming the order, so anything after it is unprotected.
It used to run ~100 lines earlier, with a Resend send, a PaymentIntent retrieve and a per-photographer
Connect reconcile + `openPayoutRow` + `createTransfer` + `settlePayoutPaid` in between — so a kill in
that window was **terminal**: buyer holding their download link, zero `payouts` rows for the
photographers not yet reached, and no second driver on the guest path to recover it.

Written last, the same kill leaves the order `pending` and the redelivery finishes it. The buyer is
not held hostage by the reorder: the download page reads through `getGuestOrderWithItems`, which does
not filter on status, so their link works from the moment the token exists.

`maxDuration = 60` raises the ceiling; it does not remove it, which is why the ordering is the actual
fix.

### T-250 — one email per streak, not per sale

Every other warning about a `connect_inactive` hold is in-app (dashboard banner, event notice,
Earnings alert) and its owner is by definition the one who has not finished onboarding — the least
likely to be looking at a dashboard.

The anti-spam rule is DB-derived on purpose: each delivery is its own serverless invocation, so an
in-process flag would dedupe nothing. Two truly concurrent first sales could send twice — bounded,
and far better than the reverse. It needs no new column and self-resets: once the retry worker drains
the streak, a later hold is worth telling them about again.

Only `connect_inactive` notifies; `below_minimum` and `transfer_failed` drain on their own and need
nothing from the photographer. Do not merge `notifyPhotographerOfHeldSale` with `reportMoneyIncident`:
that alerts **us** about a failure, this tells the **photographer** about a normal state — different
recipient, different severity.

### T-264 — one incident kind per sweep, one alert per day

The Sentry fingerprint is `['money-incident', kind]` and the email throttle is keyed per kind, so
four sweeps sharing one kind would collapse four distinct problems into a single Sentry issue and let
whichever fires first silence the others for the window. `needs-reconciliation` stays reserved for the
clawback path that already declares it. Binding on T-254 / T-255 / T-265.

A sweep alerts about a **state**, not about a pass, and the cron runs 48×/day: one alert per row per
pass is 48 identical emails a day until a human acts. `report-unconfirmed-reversals` is the reference
shape — one aggregated incident for the whole set, claimed once per rolling day through `rateLimit`
(Postgres-backed, so it holds across serverless invocations, unlike the reporter's per-process email
damper). `rateLimit` fails **open**, so a limiter outage costs a duplicate alert rather than a missed
one.

`listUnconfirmedReversals` must filter `status in ('paid','reversed')`: `applyReversalToHolds` stamps
`reversed_at` on an outstanding *hold*, where there is no transfer to reverse and no
`stripe_reversal_id` will ever appear — so without the filter every partially-refunded hold matches
forever.

That sweep **reports and does not repair**, deliberately: repairing means asking Stripe whether the
reversal happened, and `findTransferByGroup` already documents why that answer can be `unknown`
(`has_more`). Concluding wrongly reverses twice or releases a real reversal, and the next pass cannot
undo either.

### T-254 — a hold stuck beyond its window alerts, it does not just retry

The worker's failure exits deliberately never throw (a throw fails the Inngest run, not the payout),
so a `transfer_failed` hold whose `createTransfer` always fails — invalid destination, revoked
capability — was retried every 30 minutes **forever** with nothing but a console line: real, recorded
debt that never pays and that nobody hears about. Found by `/code-review xhigh` on T-249's PR #306,
whose alerts point at this very path as the recovery.

`report-stuck-holds` follows the T-264 shape (own kind `payout-hold-stuck`, one aggregated incident,
claimed once per rolling day; the ticket's DoD predates T-264 and named `needs-reconciliation`, which
that decision reserves for the clawback path). Two windows, because "stuck" has two causes:

- **24 h** for rows the worker itself is failing to drain — `pending`/`transfer_failed` (≈ 48 failed
  attempts) and ANY `processing` row (perpetual `unknown` probe, batch re-drive that keeps throwing,
  or no Connect destination, which the recovery steps skip with a bare `continue`). Deliberately no
  `stripe_charge_id` filter: `listPayableHolds` requires one as a security filter, so a charge-less
  hold is *more* stuck, not less.
- **30 days** for `connect_inactive` / `below_minimum` — legitimate states short-term (T-250 already
  emails the photographer; sub-minimum accumulates by design), but past a month they are recorded
  money nothing will ever move on its own.

The clock is **`created_at`**: the `payouts_set_updated_at` trigger re-stamps `updated_at` on every
failed retry, so `updated_at` measures the last attempt while `created_at` measures the age of the
debt. Frozen rows are excluded at any age — T-265's `dispute-freeze-stuck` owns that state.

**Where the step runs took two passes to get right.** The first version put it *before*
`resolve-payable-holds`, reasoning that the flow's nothing-payable early return is itself the sharpest
stranding — a revoked capability deactivates the account, every hold is filtered out, and the paying
steps never run, so reporting after them would go silent in exactly the case the alert exists for.
True, but incomplete: running first also means reporting rows the same pass is about to pay. A
`transfer_failed` hold whose photographer just finished onboarding becomes payable in
`resolve-payable-holds` (which live-reconciles Connect status), and step 0b hands a recovered stale
claim back as `transfer_failed` — both are older than the window, both are paid moments later, and
naming them in the one alert throttled to once a day is precisely the cry-wolf the ticket warned
about. So the sweep is one function called at **both** exits: after the transfers, and on the
early-return path. Exactly one runs per invocation and they share a step id, so a replay memoizes
either the same way.

Reports, never repairs, and the alert names the ledger as the authority instead of instructing a
manual transfer (T-249/T-255 rule: zero drained rows proves nothing is *about* to be paid).

Amounts are quoted **per currency**: `payouts.currency` is per row and `splitPayableRows` groups on it
precisely because the amounts are not comparable, so one summed figure would look authoritative and
mean nothing.

**The watchdog needed its own watchdog** (found by the silent-failure refutation pass on this PR).
Because the step runs before the paying steps, its read errors must be swallowed — a statement
timeout on the window scan cannot be allowed to stop every payout in the run. But swallowing makes
the step *succeed*, so a query that fails on every pass would silence the sweep permanently with
nothing red in the Inngest dashboard either. T-255 gets this protection from an `onFailure`, which is
unavailable here precisely because nothing throws; so the `catch` raises
`payout-hold-sweep-failed` — its own kind (the remediation is "fix the sweep", not "reconcile a
hold"), claimed daily like the state it guards. Both calls in that catch are structurally
non-throwing (`rateLimit` fails open, `reportMoneyIncident` never throws), so the guard cannot turn a
read error into a failed run.

Same pass: the 500-row cap is read at **`limit + 1`** and the overflow reported as `countsTruncatedAtRows`,
with the message downgraded to "At least N". The freeze sweep carries `deferredDisputes` for exactly
this reason — a silently capped count reads as "this is everything", which is how a Connect-wide
outage looks like 500 tidy rows.

A later `/code-review high` pass added the placement fix above plus two more: the two ledger reads are
guarded **separately**, because sharing one `try` let a persistent failure in the second discard a set
the first had already read — real stranded money hidden behind an alert that only says the check is
unwell; and the sweep-failed alert's daily claim is documented as **best-effort**, since `rateLimit` is
Postgres-backed and fails open, so the one outage that takes the database down also defeats the claim
and the alert fires per pass. That is the right direction (a flood during an outage beats silence about
a broken watchdog) but it is not the once-a-day guarantee the neighbouring sweeps have.

### T-253 — the guest delivery email is the product

A guest has no account, so the link that email carries is the only route to what they paid for — yet
the send must stay non-fatal (a 500 makes Stripe redeliver a payment already taken), which is
precisely why it has to alert.

Its context is ids only: never the buyer's address (PII) and never the download token (a bearer
credential for the photos). Nothing here is reconciled against the `payouts` table, hence its own
`subsystem: 'delivery'` Sentry tag.

### T-248 — the Connect gate both checkouts used to have

Selling and being able to receive the money are separate readiness states. Both checkouts used to
return `photographer_not_connected`, and it cost: a priced event could not be bought at all (**5 of 6
priced events in production**), the buyer got a dead-end toast, and the photographer's only signal was
a buyer asking why nothing worked. It also read the *cached* status, so a `pending` left by a lagged
webhook blocked a working account's sales.

The code is **deleted, not unused**, so reinstating the refusal cannot happen by accident.

The buyer is deliberately told nothing about the photographer's payout state: their purchase is
complete and correct, and the information is not actionable for them. The photographer is warned
instead, in proportion to what is at stake — a forecast in red trains people to ignore red, which is
why `sales_will_hold` is amber and only `money_held` is red.

---

## 6. Subscriptions and the buyer fee

### T-214 — cancellation is webhook-only

An action that wrote the cancellation state optimistically could leave the row asserting a
cancellation Stripe does not have (successful call, lost webhook) or the reverse. Hence the actions
call Stripe and write **nothing**, pinned by a test that makes both Supabase clients' `from()` throw.

`hasPendingCancellation(sub)` exists because "pending" needs the flag **and** an active-equivalent
status: a `canceled` row would otherwise offer a reactivate Stripe can no longer honour.
`.deleted` also clears the flag, so a finished row never reads as still-pending.

The undo action is `reactivate`, not `resume`, because `dashboard/photographer/billing/resume/`
already means "resume the *checkout* intent after signup/login".

`getCachedDashboardData` resolves the plan inside a `'use cache'` with `cacheLife('minutes')`, so
without the webhook's revalidation a downgrade stayed invisible — commission rates and plan limits
kept reporting the old plan until the TTL expired.

The downgrade is contention, never destruction: Free's limits live only in the write gates, and
nothing deletes photos or events. The confirmation discloses that consequence only when the
photographer already exceeds a Free cap.

Feedback is a direct toast, not a `?status=` code: those exist for *redirect* returns (Stripe's
`cancel_url`, the `resume` route), and `status=cancelled` already means *checkout abandoned*.

A row can outlive its Stripe subscription (deleted from the dashboard, wiped test data, an old dump).
Stripe then answers `resource_missing` **forever**, and treating that as a generic failure left the
photographer permanently stuck — unable to change plan *and* unable to cancel — while the stale row
still granted them a paid plan. Recovery writes nothing locally; the webhook rewrites the row off the
real subscription, so the webhook-only rule holds.

`UpgradePlanButton` used to hardcode English keyed on the target plan alone, so a Pro subscriber was
offered an "Upgrade to Starter" for what is a downgrade. It now takes a finished `ctaLabel`, resolved
in `settings/billing/page.tsx` — the only place that knows both the current plan and the dictionary.

### T-194 … T-199 — billing v2 and the buyer service fee

Rates were lowered from 12/8/5 deliberately in the *same* PR as the buyer fee line item: **Pro at 0%
is only solvent while that fee is live**, because the webhook transfers `getPhotographerNetCents(gross)`
and the platform absorbs Stripe's cost.

The fixed part is what structurally covers Stripe's own fixed per-charge cost — a percent-only
commission cannot, which is why small sales used to sell at a loss. Get either part wrong and one end
of the price range bleeds: a percent-only fee cannot cover the fixed cost on a cheap photo; a percent
below Stripe's own loses *more* the larger the sale. The binding case is a **Pro** sale, where the fee
is the only thing covering Stripe and the platform's margin comes from the subscription. A card
charging above 3% still leaves a thin negative tail on large sales — accepted for now; raise the bps
if it grows.

The three constants are plain constants and deliberately **not** env vars: they decide what every
buyer is charged, so the review trail beats deploy-free tweaking — a constant gives a diff, a
reviewer and a revertible commit, and a typo gets caught by a human rather than silently charging
everyone. Setting all three to 0 reproduces pre-v2 behaviour exactly; that is the rollback.

The PSD2 risk is surprise pricing, not the flat fee itself — which is why displayed and charged must
come from one function.

The webhook is deliberately untouched: orders/`order_items` and the photographer transfer are rebuilt
from cart metadata (guest) and `cart_items` rows (authed), never from `session.line_items`, so the fee
never inflates a photographer's gross or payout. Consequence: `orders.total_amount_cents` stays
photo-only while `orders.metadata.amount_total` (raw Stripe) is photos + fee. Anything counting photos
must use `metadata.cart_count`, **not** the line-item count — that bug bit the guest success page
(T-196).

### T-205 — sums of floors

`calculatePlatformFee` derives the commission as `gross − getPhotographerNetCents(gross)`, never
`round(gross × rate)`: an independently rounded commission disagreed with the floored payout by a
cent, so the breakdown did not add up and the Earnings tab could contradict the Sales tab for the same
sale. The Sales action used to inline its own copy of the formula.

Earnings **totals** are netted per order because that is the unit the money moves in — one transfer
per `(order, photographer)`. Netting the whole period's gross in a single call reported up to a cent
per order MORE than was ever transferred (a sum of floors is not the floor of a sum), which showed as
a withdrawable balance that could never be withdrawn. Bundle allocations land on arbitrary cents, so
they make the drift more likely, not less.

The per-row breakdown stays per line item (that is what keeps the two tabs identical), so a
multi-item order's rows can sum to a cent under its payout — a display artefact of the per-photo
split, not a discrepancy in the balance.

`<BundleDiscountNote>` fails **closed** on error because the bundle columns are migration-gated.

### T-228 — right-of-withdrawal consent

Directive 2011/83/EU art. 16(m) (Spain: art. 103.m TRLGDCU) exempts digital content from the 14-day
right of withdrawal **only** with the buyer's prior express consent to begin delivery **plus** their
explicit acknowledgement that this loses the right. A clause in the Terms achieves nothing — consumer
law is mandatory and cannot be waived by contract — so the consent is collected per purchase and
stored as evidence.

The browser sends only a boolean; the timestamp and version are stamped server-side, because a
client-supplied timestamp is worthless as evidence. In a dispute the question is *which sentence* was
ticked, and the order row is the only answer — hence the version bump rule.

The actions take the consent as a **required** parameter so the typecheck, not a reviewer, catches a
call site that forgets it, and they return `consent_required` before the rate limiter and before any
DB/Stripe work: a client bug must not burn the buyer's 10/h quota on requests that do nothing.

Transport is Stripe session metadata, the same mechanism as the guest cart's `cart_<i>`, so the
consent reaches the webhook by the same route as the order it belongs to, with no window where a
session exists but its consent does not.

The webhook fails **open** (no consent in the metadata ⇒ order still created with NULL columns): the
buyer has already paid, and withholding photos over a missing record is worse than an incomplete
record. The parser itself fails **closed** to `null` — null must never be read as "assume consent".

Art. 8.7 needs the confirmation email, which is why `sendPurchaseConfirmationEmail` exists at all:
before T-228 only guests got an email, so signed-in buyers had no confirmation on a durable medium.

---

## 7. Email

### T-253 — `resend.emails.send` does not throw

An invalid key, an unverified sender domain, a rate limit or a malformed `to` all come back as a
*resolved* promise `{ data, error }`, so a caller that discards the result reports success for a
message that was never sent. Three of the four senders did exactly that, and the guest one is the
sharp case: the buyer paid, got nothing, and the webhook's `catch` never fired.

Only the chrome is shared. The **messages** stay per sender on purpose — the guest email offers a
30-day token, the signed-in one a permanent library. `escapeHtml` had been copied per template and is
applied to event names in both buyer templates: those are photographer-typed and land in
hand-assembled HTML.

### T-250 — the footnote is a required argument

The buyer wording ("because you purchased photos") is plainly wrong on a message to a photographer
about their own sale, and a default is exactly how that ships unnoticed.

All templates are English-only, including the photographer-facing one: the buyer receipts never
receive a locale, and `profiles` stores no language preference at all, so there is nothing to read
even if we wanted to. The held-sale CTA link therefore carries no locale segment — `src/proxy.ts`
resolves one from the reader's own cookie / `Accept-Language`, so the page lands in their language
even though the email does not.

---

## 8. Reveal gate and AI search

### T-177 — what the reveal gate does and does not protect

`is_public` / `share_code` gate **access to the event**; the reveal gate gates **visibility of the
photos** within it. They compose (AND).

**Security property (v1, deliberate):** the image byte routes (`/api/watermark`, `/api/thumb`) are
**not** gated — they serve by an unguessable storage path, so with no ID in hand a visitor has
nothing to request. The UUID is the secret. The property is "photo IDs never reach an unproven
visitor + exposure is limited", not byte-level access control. Any future feature that surfaces a
gated event's photo URL or ID to an unproven visitor breaks it.

An event that was public and later gated already leaked its UUIDs, so the gate is partial for it —
marginal, since it requires pre-harvested IDs. Cart/checkout/download are untouched: they need an ID
the unproven visitor lacks.

The minors invariant (`contains_minors ⇒ !is_public`) puts minors out of scope entirely: those events
get their privacy from the share code, not this gate.

`searchFacesInEvent` mints the proof cookie over the matched ids so a reload re-serves them with no
second billable face search. The proven set is fetched via `getEventPhotosPublicByIds`, which
intersects the proof ids with the approved public set — a stale or foreign id cannot surface a photo.

### T-184 — the dead-end guard

A gated event reveals photos **only** via face search, so if the face-search entry cannot render (the
event is not searchable yet — nothing indexed, indexing in flight, or indexing failed) the visitor is
stranded with no photos and no way to find them. Non-gated events are unaffected: they browse
normally, so hiding an empty face-search entry is correct there. The guard never exposes a photo
without a match.

### T-034 / T-036 / T-141 — face-search cost controls

Order matters: tier 1 (per-IP throttle) and selfie validation run **before** the cost counters, so an
IP-throttled or garbage-payload attacker cannot inflate the global breaker — which would deny face
search platform-wide for free. A per-event trip never touches the global counter.

Counters decide on the **returned** count so a concurrent burst cannot undercount. `AWS_CALLS_PER_FACE_SEARCH`
is 1: a search issues exactly one billable `SearchFacesByImage` op (detection and search are bundled;
there is no separate `DetectFaces` call).

Caps are env-configurable, never hardcoded, so they can be raised the day a real 300-runner event's
athletes start searching. A breaker trip leaves bib search and the rest of the app unaffected —
separate, non-AWS path.

CAPTCHA is deliberately not built here (tripwire T-141).

**T-036** removed a half-built per-plan monthly search quota (`ai_search_usage` +
`AI_SEARCH_RATE_LIMITS`) because the anonymous searcher is not the plan owner. Do not re-advertise a
"N searches/month" number.

### T-089 — backfill de-duplication

The two per-event backfill workers are cost gates: each fans out one AWS-billed job per photo.
Debounce (a sliding window) is used deliberately over an event-`id` idempotency key, whose 24h dedup
memory would silently drop a legitimate later re-index — or a disable→re-enable — that reused the same
key. Concurrency 1 per event is the backstop for runs that still overlap. The per-photo fan-out sends
carry **no** dedup key: a re-index must legitimately re-process each photo.

### T-032 — bib detection

`photo_bib_numbers` is both the raw detection data and the search target: bib search matches on
`bib_text`, one row per bib per photo. `photos.bib_detection_status` is the per-photo job status only
and never holds bib values.

Backfill fans out a bib-specific `photo.bib-detect` event so it never re-runs the face/thumbnail jobs.
Bib numbers are low-sensitivity race identifiers, not PII; the `contains_minors` parity keeps minors'
photos no more exposed than face search already allows. `DetectText` is billed per image, and the
per-event opt-in is the only throttle.

The talent-dashboard grid-filter gap (results filtered on the public page but not in the dashboard) is
fixed — both surfaces are symmetric now. **T-064:** enabling/disabling busts the event cache tags so
the bar appears/disappears immediately.

---

## 9. Dead schema and dead routes

### T-219 — the prune

Dropped: `payment_accounts` (an earlier payout design storing bank/PayPal details in a `jsonb` column
with **zero readers** — held data, no product, superseded by Stripe Connect), `payouts.payment_account_id`,
`ai_search_profiles`, `ai_search_usage`, `time_sync_tokens`, `upload_batches`, `upload_objects`, the
`vector` extension, `organizer_fee_per_photo_cents`, `time_offset` / `time_sync_enabled`, and
defensively `profiles.is_admin` again.

`ai_search_profiles` was the last remnant of the abandoned CLIP/pgvector matching path
(`selfie_embedding` had already gone in `20260518000000_drop_legacy_ai_schema.sql`).

`test/unit/database/dead-schema-pruned.test.ts` keeps them from coming back and fails on any
`is_admin` reference under `src/`. That guard is the point: **a column named like a gate that gates
nothing is how the next bypass gets written in good faith** — `profiles` has a public SELECT policy,
which is why the flag was moved out of it.

### T-202 / T-220 — the deleted routes

`api/billing/checkout` and `api/billing/cancel` had zero callers, but they were live `POST` endpoints
any authed user could hit to create a Stripe customer + `subscriptions` row through a flow that had
drifted from the action replacing it.

`api/admin/payouts/[id]` was the last Server-Action exception under `src/app/api/`; see
[T-220](#t-220--the-admin-payout-endpoint) for why deleting it removed a capability rather than dead
code. `updatePayoutStatus` and `createPayout` (the dead self-insert helper) went with it.

---

## 10. Security and infrastructure

### `search_users_by_text` — the substring oracle

A `SECURITY DEFINER` **search** RPC is reachable directly through PostgREST with a user JWT, so the
Server Action wrapping it guards nothing.

Matching a substring of a secret and returning a stable id **is an oracle**, even if the secret is not
in the returned columns: the caller learns, one probe at a time, whether a given user's value contains
a given string. So the function neither returns nor substring-matches email — it matches email by
exact equality, keeps substring matching for `username`/`display_name`, and keeps email out of the
`order by` (ranking by an email prefix is the same channel). Prefer resolving PII server-side from
known ids (`get_user_emails_batch`).

`drop function` throws the grants away and Postgres re-grants `EXECUTE` to `PUBLIC` on the
replacement, so a migration that drops and recreates one must re-apply the revoke in the same file
(`20260804000000`). `revoke from public` does not override role-specific grants.

### T-227 — the profiles column grant, and what measuring RLS found

The ticket was "add RLS tests for the 19 untested tables". Measuring the surface found a live data
exposure, which is why the ticket said *"solo tests… salvo que aparezca un agujero"*.

**What leaked.** `photographer_profiles_public_select` is `using (active_role = 'PHOTOGRAPHER')`, and
RLS is ROW-level: a policy that admits the row admits every COLUMN of it. With Supabase's default
`grant all` to `anon`, one unauthenticated request returned the photographer's legal name, full postal
address, `stripe_customer_id`, `stripe_connect_account_id` and `payout_details_json`. `active_role`
DEFAULTS to `PHOTOGRAPHER`, so it reached almost every row. Verified over HTTP against the local stack
with the anon key, not inferred from the policy text; the policy ships in a migration, so production
had it too.

**Why a column grant.** RLS cannot restrict columns, so the options were a public view, moving the
columns to a second table, or column-level GRANTs. Only the last closes the hole without touching
application code, and it has a second benefit: the grant list becomes the allow-list, so a column
added to `profiles` is no longer public by default. The granted set was derived from the code that
actually reads `profiles` as anon (`getPhotographerBySlug`, plus `active_role` because Postgres
requires SELECT on a column to filter by it) — not from a judgement about what "looks" public.

**Why `authenticated` is still open.** A column grant is per-role and cannot distinguish "my row" from
"someone else's", so restricting `authenticated` would break a photographer reading their own address
in settings. Closing that half needs the columns moved out of `profiles`; it is a separate ticket, and
`profiles-rls.test.ts` asserts the gap so it stays a recorded decision rather than a rediscovery.

**Why `supabase/seed.sql` repeats the grant.** Its blanket `grant select … on all tables in schema
public` runs AFTER the migrations on `db reset`. Without repeating the revoke + column grant there,
the fix would not exist locally, and the new RLS tests would be asserting a posture no deployed
environment has. The asymmetry matters more generally: **revoking TRUNCATE survives the seed** (the
seed re-grants only SELECT/INSERT/UPDATE/DELETE), while revoking any DML would be silently undone on
every reset — which is what makes one half of the grant tightening cheap and the other a trap.

**TRUNCATE.** Not subject to RLS, held by `anon` and `authenticated` on all 26 tables purely as the
bootstrap default. Not exploitable today — PostgREST exposes no TRUNCATE verb and no persisted
function in `public` builds dynamic SQL — so this is defence in depth, revoked along with REFERENCES
and TRIGGER, plus an `alter default privileges` so a future table cannot re-arm it.

**Two things the sweep discovered that were not bugs.** First, the `is_public` branch of the
`photo_faces` / `photo_bib_numbers` policies is UNREACHABLE: a policy expression is evaluated as the
calling role, so its `EXISTS` over `photos`/`events` is itself RLS-filtered, and both are owner-only.
Those tables are stricter than they read — harmless, because face search goes through `supabaseAdmin`,
but pinned, because the policy invites the opposite conclusion. It is also why `orders` needs the
`order_has_photographer_items` SECURITY DEFINER helper. Second, `user_role_memberships` lets a user
self-grant a role through PostgREST; that is safe **because the `user_role` enum holds only
PHOTOGRAPHER and TALENT** (both self-service in the product) and admin lives in `admin_users`. Adding a
privileged value to that enum would turn the policy into privilege escalation — asserted where it
would be noticed.

**What the code review added.** The column allow-list is **SELECT only**: `authenticated` keeps
table-wide INSERT/UPDATE and `profiles_self_update` restricts the row but not the columns, so a
photographer can still `PATCH` their own `stripe_connect_account_id`. Left open here because the app
writes those columns with the USER's client (`settings/payout-profile/actions.ts`), so a column-level
UPDATE grant needs that call site moved to `supabaseAdmin` first — and because every money path
re-derives Connect status from Stripe before transferring, and redirecting one's own payout account is
self-harm rather than theft. Folded into T-268 with the read half, and pinned by a test that fails the
day it is closed. The same pass widened the inventory beyond `relkind = 'r'` (a `public` VIEW without
`security_invoker` bypasses the base table's RLS entirely, and T-268's own option 2 is "serve it by
view"), and replaced the hand-copied column list with one read from `information_schema` so the
migration, the seed and the test cannot drift apart. It also established that
`alter default privileges` cannot be applied to the `supabase_admin` grantor from a migration —
`postgres` gets "permission denied" — so that half of the TRUNCATE posture is asserted locally and
unverified in production.

**The advisors gate could not have caught any of this.** Supabase's linter has no table-privilege or
column-grant rule; its `rls_enabled_no_policy` findings are already baselined. That is the argument
for the in-repo inventory test rather than a reason to trust CI.

### T-268 — a view, not a private table

T-227 closed the `anon` half of the `profiles` exposure and left two halves open on purpose. This
closed both: `photographer_profiles_public_select` is **gone**, so `profiles` is self-only and no
policy admits another user's row for any role; and `authenticated` lost table-wide INSERT/UPDATE in
favour of a column grant, so the payout destination is unwritable by the user.

**Why a view and not the private table the ticket proposed.** The census killed that option on its
own terms: such a table would hold user-editable fields (`full_name`, the postal address,
`is_payout_profile_complete` — all written by the payout-profile form) next to system-only fields
(`stripe_connect_*`). A self-write policy on it would reintroduce exactly the column problem, so it
would need splitting in **two** tables to be genuinely structural — and it would have repointed the
query functions the Stripe webhook and the retry worker depend on. The view keeps the money path
untouched and still makes the read surface an allow-list.

⚠️ **`public_profiles` runs with OWNER rights (no `security_invoker`), and that is load-bearing.** An
invoker view would be evaluated as the caller and would return nothing now that the base table is
self-only. Owner rights are what let it project rows the base RLS hides — which is precisely why **its
select list is the security boundary**: a column added there is world-readable immediately, with no
policy left to catch it. It keeps the dropped policy's `active_role = 'PHOTOGRAPHER'` filter, so
nothing widened; talent profiles were not public before and are not now.

**Reads and writes get different mechanisms on purpose.** Reads are closed structurally (the policy is
gone; there is no list to maintain). Writes need a column grant, because the same table legitimately
takes user writes on other columns — there is no way around a list there. So the list is backed twice:
the grant is the real barrier, and `USER_WRITABLE_PROFILE_COLUMNS` in `queries/profiles.ts` filters
the object at runtime. That second layer is not redundant: `updateProfile`'s `Pick<>` is erased at
compile time and `updatePayoutProfileAction` passes its client-supplied argument straight through, so
before this a hand-crafted Server Action request could set any column, including
`stripe_connect_account_id`, whatever the grants said.

**Four write call sites moved to `supabaseAdmin`.** `connectStripeAccountAction` had no `catch`, so
without the move Connect onboarding would have broken hard; the three
`reconcileAndPersistConnectStatus` callers write inside a `.catch()` that only logs, so they would
have failed **silently** — the UI would have stayed correct (the helper returns the reconciled status
either way) while the cached column was never updated again. All three write the caller's own row with
a value that comes from Stripe, never from user input, which is what makes the service role right
there rather than a shortcut.

⚠️ **Making `profiles` self-only turned three display-name lookups into silent blanks**, and that is
the failure mode to remember: a user-scoped read of somebody else's row now returns `[]` **with no
error**, so nothing breaks loudly — the UI just loses the name. Found by the review pass, not by the
suite. `getEventPhotographers` (the contributor list on an organizer event),
`getPendingInvitationsForPhotographer` (who invited you) and `getTagsForPhotos` (the tagged athlete on
your own photo) all enrich with `.in('id', otherPeoplesIds)` on the caller's client. They now read
through `supabaseAdmin` inside the query layer — the ids come from rows the caller was already
authorized to see, and only public columns are selected. ⚠️ `public_profiles` is **not** usable for
these: it filters `active_role = 'PHOTOGRAPHER'`, and the subjects may be in TALENT mode. Pinned by a
regression test in `test/integration/queries/talent-photo-tags.test.ts` that asserts the NAME rather
than the row — the row was always there; only the name went missing.

**Six dead columns dropped rather than protected** (`payout_method`, `payout_details_json`,
`stripe_customer_id`, `default_city`, `default_country`, `default_province`): no reader, no writer, no
UI, and four were not even in the TypeScript types. The first two hold bank details per their own
migration comment and are the DB half of the pre-Connect payout design whose table, `payment_accounts`,
T-219 already dropped — their dictionary UI has sat orphaned ever since. ⚠️ `profiles.stripe_customer_id`
is not the live one; the customer ids the app reads live on `subscriptions`, `orders` and
`guest_orders`. `is_payout_profile_complete` was NOT dropped despite being equally vestigial (its only
live reader is a cosmetic badge, and its migration's "gates payout requests" claim is false today) —
it drives visible UI, and removing visible behaviour does not belong in a security fix.

### T-225 — the advisors CI gate

It runs against **staging**, pinned by the `projectRef` in `scripts/advisors-baseline.ts`: a Supabase
PAT is account-wide (there is no per-project management token), so the versioned ref, not the
credential, is what keeps the job off production.

It does not replace the `SECURITY DEFINER` inventory test: that one reads the schema rebuilt from
`supabase/migrations/`, this one reads a real project and therefore catches drift the migrations do
not describe (`sync_profile_avatar_url` is live in prod and created by no migration).

### T-192 — the webhook host

The production Stripe endpoint must be the `www` host: the apex 307-redirects and Stripe does not
follow redirects, so every delivery was dead until 2026-07-28. Resending events from the dashboard is
routine here because of that backlog — which is why several money-path guards are written against
redelivery rather than assuming one delivery per payment.

### Cron slots

`0,30` storage cleanup · `15,45` indexing reconciliation · `10,40` payout retries (T-216). Deliberately
offset so the three never contend; pick a fourth slot for any new cron.

`retry-pending-payouts` is **one** function with a cron trigger *and* a `payouts.retry-requested` event
trigger: Inngest scopes `concurrency` per function id, so splitting it into two registrations would
give two independent limits and allow concurrent payout runs for the same photographer.

### T-256 — repo vs. deployed

`main` is the only source of truth for what shipped. ~140 merged remote branches exist; never read a
branch name as a feature's status.
