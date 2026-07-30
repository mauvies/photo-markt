'use client';

import { Sparkles } from 'lucide-react';
import type { BundleNextTierPrompt } from '@/lib/cart-bundle-pricing';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';

/**
 * "Add 1 more photo and pay €12 for all 3" — the next-rung nudge in the cart
 * (T-204).
 *
 * Computed by `priceCartWithBundles`, never here: the total promised is the total
 * that rung will actually charge, priced through the same kernel the checkout
 * uses. A prompt that quoted a number the checkout then disagreed with would be
 * worse than no prompt at all.
 *
 * Renders nothing when no further rung exists, so a cart that has already
 * reached the top of the ladder is not told to keep buying.
 */

export interface CartNextTierLabels {
  /** One more photo needed. `{price}` = the resulting total. */
  one: string;
  /** `{n}` more photos needed, `{price}` = the resulting total. */
  many: string;
}

interface CartNextTierPromptProps {
  nextTier: BundleNextTierPrompt | null;
  labels: CartNextTierLabels;
}

export function CartNextTierPrompt({ nextTier, labels }: CartNextTierPromptProps) {
  if (!nextTier || nextTier.photosNeeded <= 0) return null;

  const price = `${PLATFORM_CURRENCY_SYMBOL}${(nextTier.resultingTotalCents / 100).toFixed(2)}`;
  const template = nextTier.photosNeeded === 1 ? labels.one : labels.many;
  const message = template
    .replace('{n}', String(nextTier.photosNeeded))
    .replace('{price}', price)
    .replace('{total}', String(nextTier.minQuantity));

  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
