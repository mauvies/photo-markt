import type Stripe from 'stripe';
import { stripe } from './config';

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
