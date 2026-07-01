import type Stripe from 'stripe';
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

export async function createExpressAccount(params: {
  email: string;
  country: string;
}): Promise<string> {
  const account = await stripe.accounts.create({
    type: 'express',
    email: params.email,
    country: params.country,
    capabilities: {
      transfers: { requested: true },
    },
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

export async function retrieveConnectBalance(accountId: string): Promise<{
  available: number;
  pending: number;
}> {
  const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
  const available = balance.available
    .filter((b) => b.currency === 'usd')
    .reduce((sum, b) => sum + b.amount, 0);
  const pending = balance.pending
    .filter((b) => b.currency === 'usd')
    .reduce((sum, b) => sum + b.amount, 0);
  return { available, pending };
}

export async function createTransfer(params: {
  amountCents: number;
  destination: string;
  sourceTransaction: string;
  transferGroup?: string;
  idempotencyKey: string;
}): Promise<Stripe.Transfer> {
  return stripe.transfers.create(
    {
      amount: params.amountCents,
      currency: 'usd',
      destination: params.destination,
      source_transaction: params.sourceTransaction,
      transfer_group: params.transferGroup,
    },
    { idempotencyKey: params.idempotencyKey },
  );
}
