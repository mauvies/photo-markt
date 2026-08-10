import type Stripe from 'stripe';
import { type StripeConnectStatus, updateProfileStripeConnect } from '@/database/queries/profiles';
import type { SupabaseServerClient } from '@/database/queries/types';
import { stripe } from './config';

/**
 * Derive Stripe Connect account status from the account object.
 * Shared between the webhook handler and the live-status check in
 * the payout-profile page so both sources stay in sync.
 *
 * `pending`    → photographer hasn't finished Stripe onboarding
 *                (details_submitted=false). They must return to Stripe
 *                to complete the process (including identity verification).
 * `restricted` → details submitted but Stripe is reviewing, or Stripe
 *                requires additional information to enable payouts.
 * `active`     → fully enabled; charges and payouts are live.
 */
export function deriveConnectStatus(account: Stripe.Account): 'pending' | 'active' | 'restricted' {
  if (account.charges_enabled && account.payouts_enabled) return 'active';
  if (account.details_submitted) return 'restricted';
  return 'pending';
}

/**
 * Fetch a Stripe Connect account by ID for a live status check.
 * Returns null if the account doesn't exist or the call fails so
 * callers can gracefully fall back to the DB-cached value.
 */
export async function retrieveConnectAccount(accountId: string): Promise<Stripe.Account | null> {
  try {
    return await stripe.accounts.retrieve(accountId);
  } catch {
    return null;
  }
}

/**
 * Reconcile a DB-cached Connect status against the live Stripe account.
 *
 * The `account.updated` webhook can lag or be missed, leaving
 * `profiles.stripe_connect_status` stale — most damagingly a `pending` value
 * for an account that is actually `active`, which both shows the "under
 * review" banner and causes the `payment_intent.succeeded` handler to HOLD the
 * photographer's transfer in the platform account. This helper is the single
 * source of truth for the live check, shared by the dashboard, the
 * payout-profile page, and the webhook transfer path so they can't drift.
 *
 * Fetches the account only when an `accountId` is present, and falls back to
 * the stored value if the account can't be retrieved (`retrieveConnectAccount`
 * already swallows API errors). Callers decide whether/how to persist a
 * changed value.
 */
export async function reconcileConnectStatus(
  accountId: string | null | undefined,
  storedStatus: StripeConnectStatus,
): Promise<{ status: StripeConnectStatus; changed: boolean }> {
  if (!accountId) return { status: storedStatus, changed: false };

  const account = await retrieveConnectAccount(accountId);
  if (!account) return { status: storedStatus, changed: false };

  const liveStatus = deriveConnectStatus(account);
  return { status: liveStatus, changed: liveStatus !== storedStatus };
}

/**
 * Reconcile a cached Connect status against Stripe AND persist a healed value,
 * returning the effective status to use. The single entry point shared by the
 * dashboard, payout-profile page, and webhook transfer gate so the heal
 * semantics can't drift between them.
 *
 * Two deliberate guarantees:
 *   - **Only heals a non-active cached status.** An `active` cached value is
 *     treated as authoritative — legitimate downgrades arrive via the
 *     `account.updated` webhook, the source of truth. This avoids a blocking
 *     Stripe call on the hot dashboard path for the common active case, and
 *     avoids flipping an active account to "restricted" on a transient Stripe
 *     read blip. The live check exists to *promote* a stale `pending`/
 *     `restricted` that Stripe already enabled.
 *   - **Awaits the DB write.** A React Server Component / serverless handler can
 *     be torn down right after the response, dropping a fire-and-forget write —
 *     so the heal would never persist and the Stripe call would repeat every
 *     load. Awaiting (errors swallowed + logged) makes the heal stick. The DB
 *     write is a single fast update; the cost is negligible.
 */
export async function reconcileAndPersistConnectStatus(params: {
  client: SupabaseServerClient;
  userId: string;
  accountId: string | null | undefined;
  storedStatus: StripeConnectStatus;
}): Promise<StripeConnectStatus> {
  const { client, userId, accountId, storedStatus } = params;
  if (storedStatus === 'active' || !accountId) return storedStatus;

  const { status, changed } = await reconcileConnectStatus(accountId, storedStatus);
  if (changed) {
    await updateProfileStripeConnect(client, userId, { stripe_connect_status: status }).catch(
      (err) => console.error('[connect] failed to sync connect status:', err),
    );
  }
  return status;
}

export async function createExpressAccount(params: {
  email: string;
  country: string;
}): Promise<string> {
  const account = await stripe.accounts.create({
    type: 'express',
    email: params.email,
    country: params.country,
    // Our payout model is destination transfers: charges settle on the
    // platform account and the connected account only ever *receives*
    // transfers, so `transfers` is the only capability we functionally need.
    // Stripe, however, forbids requesting `transfers` for a US connected
    // account without also requesting `card_payments` — the request 400s
    // otherwise (T-191). We therefore add `card_payments` only for US, keeping
    // non-US onboarding minimal (a `transfers`-only recipient carries lighter
    // onboarding requirements). This is a Stripe capability requirement only;
    // charges still stay on the platform account and the transfer/payout path
    // is unchanged.
    capabilities:
      params.country === 'US'
        ? { transfers: { requested: true }, card_payments: { requested: true } }
        : { transfers: { requested: true } },
    business_type: 'individual',
  });
  return account.id;
}

export async function createAccountLink(params: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: params.accountId,
    refresh_url: params.refreshUrl,
    return_url: params.returnUrl,
    type: 'account_onboarding',
  });
  return link.url;
}

/**
 * A single-use link into the photographer's own Stripe Express dashboard.
 *
 * This is the only way they can reach it: an Express account has no password and
 * no login page of its own — Stripe expects the platform to mint this link. Until
 * now nothing did, so a photographer could see a balance in our UI and had no way
 * to check when it reaches their bank, change their payout schedule, or see the
 * transfers behind the number.
 *
 * ⚠️ The link authenticates the bearer into that account, so the caller MUST have
 * resolved `accountId` from the authenticated user's own profile — never from
 * anything the client sent. Expires in a few minutes and cannot be reused, so it
 * must be minted per click and never stored or logged.
 *
 * Throws for an account that has not finished onboarding (Stripe refuses a login
 * link before then), which is why callers gate on an `active` status.
 */
export async function createExpressLoginLink(accountId: string): Promise<string> {
  const link = await stripe.accounts.createLoginLink(accountId);
  return link.url;
}

export async function retrieveConnectBalance(accountId: string): Promise<{
  available: number;
  pending: number;
}> {
  // stripe-node v22 separates request params from request options: the
  // connected-account header (`stripeAccount`) is a RequestOption (2nd arg),
  // no longer accepted inside the params object.
  const balance = await stripe.balance.retrieve(undefined, { stripeAccount: accountId });
  // Sum the account's balance across whatever currency it holds rather than
  // filtering to a single hardcoded currency. An Express account settles in one
  // currency (its country default — EUR for EU photographers, but a legacy
  // non-EU account may hold USD from pre-T-193 sales), so a hardcoded filter
  // would zero out the widget and hide real funds when the account's currency
  // differs from the platform's. The earnings UI labels the total in EUR; the
  // rare non-EUR account is a minor label imprecision, never hidden money.
  const available = balance.available.reduce((sum, b) => sum + b.amount, 0);
  const pending = balance.pending.reduce((sum, b) => sum + b.amount, 0);
  return { available, pending };
}

export async function createTransfer(params: {
  amountCents: number;
  /**
   * Must equal the currency of the `sourceTransaction` charge — Stripe rejects
   * a transfer whose currency differs from its source charge. Pass the ORDER's
   * stored currency (which was set from the charge), NOT a global platform
   * constant: a charge made before the USD→EUR switch (T-193) settles in USD,
   * and its post-deploy transfer must still be USD or the payout is stranded.
   */
  currency: string;
  destination: string;
  /**
   * The charge funding this transfer. **Omitted only for an aggregated
   * sub-minimum batch (T-216)**, which spans several charges — Stripe allows at
   * most one source charge per transfer. Without it the transfer draws on the
   * platform's *available* balance instead of the charge's funds, so it can fail
   * with `balance_insufficient`; that is why only sub-50-cent leftovers, whose
   * amounts are tiny by construction, take this path.
   *
   * Keeping it on every other transfer also buys a double-pay guard that never
   * expires: Stripe refuses a transfer that would over-draw a charge, whereas an
   * idempotency key only dedupes for 24 hours.
   */
  sourceTransaction?: string;
  transferGroup?: string;
  idempotencyKey: string;
}): Promise<Stripe.Transfer> {
  return stripe.transfers.create(
    {
      amount: params.amountCents,
      currency: params.currency,
      destination: params.destination,
      ...(params.sourceTransaction ? { source_transaction: params.sourceTransaction } : {}),
      transfer_group: params.transferGroup,
    },
    { idempotencyKey: params.idempotencyKey },
  );
}

/**
 * Look for a transfer already made under a given `transfer_group` (T-216).
 *
 * Recovery probe for a batch left mid-flight. An idempotency key only dedupes
 * for 24 hours, so re-driving a batch older than that could create a second
 * transfer; `transfer_group` is the only server-side filter `transfers.list`
 * offers, which is why the batch id is written there as well as into the key.
 *
 * Two deliberate properties:
 *   - **Destination and amount are re-checked**, not just "a transfer exists".
 *     Matching the group alone would let an unrelated or partial transfer mark
 *     the wrong rows paid.
 *   - **A failed lookup returns `'unknown'`, never `'none'`.** Treating a Stripe
 *     read blip as "nothing found" would turn it into a double payment; the
 *     caller must decline to transfer on `unknown`.
 */
export async function findTransferByGroup(params: {
  transferGroup: string;
  destination: string;
  amountCents: number;
}): Promise<
  { outcome: 'found'; transfer: Stripe.Transfer } | { outcome: 'none' } | { outcome: 'unknown' }
> {
  try {
    const list = await stripe.transfers.list({
      transfer_group: params.transferGroup,
      limit: 10,
    });

    const match = list.data.find((transfer) => {
      const destination =
        typeof transfer.destination === 'string'
          ? transfer.destination
          : (transfer.destination?.id ?? null);
      return destination === params.destination && transfer.amount === params.amountCents;
    });

    if (match) return { outcome: 'found', transfer: match };
    // An empty page is only conclusive when Stripe answered. `has_more` means we
    // did not see everything, so we must not conclude "none".
    return list.has_more ? { outcome: 'unknown' } : { outcome: 'none' };
  } catch (err) {
    console.error('[connect] transfer-group probe failed:', err);
    return { outcome: 'unknown' };
  }
}
