/**
 * Stripe configuration
 */

import Stripe from 'stripe';
import { env } from '@/env.mjs';
import { installStripeWarningFilter } from './suppress-accounts-v2-warning';

// Drop the informational "Accounts v2" recommendation stripe@22 emits on every
// Connect Accounts v1 call — we stay on v1 deliberately (T-164). Installed here,
// once, on the server where the Stripe client is first imported. All other
// warnings are forwarded untouched.
installStripeWarningFilter();

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-06-24.dahlia',
  typescript: true,
});
