-- T-228: record the buyer's right-of-withdrawal consent with the order.
--
-- Directive 2011/83/EU art. 16(m) only exempts digital content from the 14-day
-- right of withdrawal when the consumer expressly consented to immediate
-- delivery AND acknowledged losing that right. In a dispute the trader has to
-- prove both, so the consent is stored on the order itself: when it was given
-- and which wording was accepted.
--
-- Deliberately NULLABLE: rows created before this shipped have no consent, and
-- a Stripe session created before the deploy must still be able to complete
-- (the webhook fails open — see src/app/api/stripe/webhook/route.ts).

alter table public.orders
  add column if not exists withdrawal_consent_at timestamptz,
  add column if not exists withdrawal_consent_version text;

alter table public.guest_orders
  add column if not exists withdrawal_consent_at timestamptz,
  add column if not exists withdrawal_consent_version text;

comment on column public.orders.withdrawal_consent_at is
  'T-228: instant the buyer gave the art. 16(m) consent (express request for immediate delivery + acknowledgement of losing the right of withdrawal). NULL = no consent on record.';
comment on column public.orders.withdrawal_consent_version is
  'T-228: value of WITHDRAWAL_CONSENT_VERSION (src/lib/withdrawal-consent.ts) when consent was given — identifies which wording was accepted.';

comment on column public.guest_orders.withdrawal_consent_at is
  'T-228: instant the buyer gave the art. 16(m) consent (express request for immediate delivery + acknowledgement of losing the right of withdrawal). NULL = no consent on record.';
comment on column public.guest_orders.withdrawal_consent_version is
  'T-228: value of WITHDRAWAL_CONSENT_VERSION (src/lib/withdrawal-consent.ts) when consent was given — identifies which wording was accepted.';
