/**
 * Stripe configuration
 */

import Stripe from 'stripe';
import { env } from '@/env.mjs';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-02-25.clover',
  typescript: true,
});
