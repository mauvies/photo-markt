-- T-214: persist Stripe's `cancel_at_period_end` so the app can tell an active
-- subscription apart from an active-but-cancelled one.
--
-- Additive and defaulted on purpose: `false` is the true statement about every
-- existing row (nobody has a pending cancellation today), so the default IS the
-- fact and no reader has to disambiguate a third `null` state. Rollback is
-- inert — reverting the code leaves the column unread, so there is no
-- down-migration.
--
-- RLS is deliberately untouched: `subscriptions` stays RLS-enabled with zero
-- policies (service-role only), the invariant pinned by
-- test/integration/security/subscriptions-rls.test.ts.

alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;

comment on column public.subscriptions.cancel_at_period_end is
  'Mirrors Stripe subscription.cancel_at_period_end. Written ONLY by the Stripe webhook (customer.subscription.created/updated/deleted) via the service-role client — Stripe is the source of truth and this row follows. Server Actions never write it (T-214).';
