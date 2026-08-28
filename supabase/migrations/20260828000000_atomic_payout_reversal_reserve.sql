-- T-260: make the reversal reserve/release atomic.
--
-- `reservePayoutReversal` and `releasePayoutReversal` (queries/payouts.ts) were
-- read-modify-write against `reversed_amount_cents`: SELECT the current value,
-- add the delta in JavaScript, UPDATE the result. The caller's delta is itself
-- computed from an EARLIER read (`listReversibleRowsForCharge`), so two reads of
-- the same column bracket the arithmetic.
--
-- Two concurrent deliveries for one charge — `charge.refunded` racing
-- `charge.dispute.closed`-won, both entering `applyClawback` — interleave as
-- read A, write A, read B (which now sees A's write), write B, while B's delta
-- was derived from the pre-A value. The row records the delta twice.
--
-- Stripe is unaffected: the reversal idempotency key encodes the CUMULATIVE
-- target, so both deliveries carry the same key and only one reversal is ever
-- performed. The damage is confined to the ledger, and it is permanent —
-- `getTotalPaidOut` is net of reversals, so an over-reported reversal
-- understates the photographer's balance forever, and every later delta computes
-- `max(0, target - already)` = 0, so the next legitimate reversal silently does
-- nothing.
--
-- Both functions do the arithmetic inside a single statement, so the row is
-- locked for the read-and-write and concurrent callers serialise. The clamps
-- (`least`/`greatest` against `amount_cents` and 0) move with them — expressing
-- them in SQL is what makes the whole operation one statement.
--
-- ⚠️ `status` stays DERIVED here, exactly as it was in the JS: reserve promotes
-- to `reversed` only once nothing is left, and release recomputes from the new
-- total rather than restoring a captured previous value. Writing back a captured
-- status is the bug the release docstring already warns about.

create or replace function public.reserve_payout_reversal(
  p_payout_id uuid,
  p_reversed_cents integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  update public.payouts
  set
    reversed_amount_cents = least(
      amount_cents,
      coalesce(reversed_amount_cents, 0) + greatest(0, p_reversed_cents)
    ),
    reversed_at = now(),
    status = case
      when least(
        amount_cents,
        coalesce(reversed_amount_cents, 0) + greatest(0, p_reversed_cents)
      ) >= amount_cents then 'reversed'
      else status
    end
  where id = p_payout_id
  returning reversed_amount_cents into v_total;

  if not found then
    raise exception 'payout % not found', p_payout_id;
  end if;

  return v_total;
end;
$$;

create or replace function public.release_payout_reversal(
  p_payout_id uuid,
  p_reversed_cents integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  update public.payouts
  set
    reversed_amount_cents = greatest(
      0,
      coalesce(reversed_amount_cents, 0) - greatest(0, p_reversed_cents)
    ),
    status = case
      when greatest(
        0,
        coalesce(reversed_amount_cents, 0) - greatest(0, p_reversed_cents)
      ) >= amount_cents then 'reversed'
      else 'paid'
    end
  where id = p_payout_id
  returning reversed_amount_cents into v_total;

  if not found then
    raise exception 'payout % not found', p_payout_id;
  end if;

  return v_total;
end;
$$;

-- Lock down execute. `payouts` is photographer-read / service-role-write
-- (20260807000000); a SECURITY DEFINER function that moves a money column must
-- not be reachable with the anon key that ships in the browser bundle. Supabase
-- grants EXECUTE on public-schema functions to anon/authenticated at bootstrap
-- and those named grants override a PUBLIC revoke, so revoke from the roles too.
revoke all on function public.reserve_payout_reversal(uuid, integer) from public;
grant execute on function public.reserve_payout_reversal(uuid, integer) to service_role, postgres;
revoke execute on function public.reserve_payout_reversal(uuid, integer) from anon, authenticated;

revoke all on function public.release_payout_reversal(uuid, integer) from public;
grant execute on function public.release_payout_reversal(uuid, integer) to service_role, postgres;
revoke execute on function public.release_payout_reversal(uuid, integer) from anon, authenticated;

comment on function public.reserve_payout_reversal(uuid, integer) is
  'T-260: atomically add N cents to payouts.reversed_amount_cents, clamped to amount_cents, returning the new total. Service-role only.';

comment on function public.release_payout_reversal(uuid, integer) is
  'T-260: atomically subtract N cents from payouts.reversed_amount_cents, clamped at 0, returning the new total. Service-role only.';
