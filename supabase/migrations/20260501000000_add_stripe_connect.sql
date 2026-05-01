-- Add Stripe Connect columns to profiles table
ALTER TABLE public.profiles
  ADD COLUMN stripe_connect_account_id TEXT,
  ADD COLUMN stripe_connect_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (stripe_connect_status IN ('not_connected', 'pending', 'active', 'restricted'));

-- Add stripe_transfer_id to payouts for logging automatic Stripe transfers
ALTER TABLE public.payouts
  ADD COLUMN stripe_transfer_id TEXT UNIQUE;

-- Indexes for webhook lookups and checkout blocking
CREATE INDEX idx_profiles_stripe_connect_account_id
  ON public.profiles (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

CREATE INDEX idx_profiles_stripe_connect_status
  ON public.profiles (stripe_connect_status);

CREATE INDEX idx_payouts_stripe_transfer_id
  ON public.payouts (stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;
