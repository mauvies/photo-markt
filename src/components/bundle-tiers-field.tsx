'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type BundleTier,
  eventSupportsBundles,
  getEffectivePerPhotoCents,
  MAX_BUNDLE_TIERS,
  MIN_BUNDLE_TIER_QUANTITY,
} from '@/lib/bundle-pricing';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

interface BundleTiersFieldProps {
  /** Current ladder, or null when the event has none. */
  value: BundleTier[] | null;
  onChange: (value: BundleTier[] | null) => void;
  /** Current "all photos" flat price in CENTS, or null. */
  allPhotosCents: number | null;
  onAllPhotosChange: (cents: number | null) => void;
  /**
   * The LIVE unit price in euros, as the photographer is typing it — not the
   * stored one. Eligibility and the per-photo readouts both depend on it, so a
   * price being set for the first time must make the editor appear immediately.
   */
  pricePerPhoto: number | null;
  /** Organizer events can never carry a ladder. */
  eventType: 'solo' | 'collaborative' | 'organizer';
  t: Dictionary['bundlePricing'];
}

function formatCents(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

/**
 * Ladder editor for an event's volume packs (T-203).
 *
 * A plain CONTROLLED component rather than one bound to a form instance: both
 * event forms use it — the create wizard and the edit form — and their TanStack
 * schemas are separate types whose generics cannot be shared without `any`
 * casts that then break `pushFieldValue`'s inference. Each call site wires
 * `value`/`onChange`/`pricePerPhoto` from its own `form.Field`, where the types
 * are already correct.
 *
 * Deliberately does NOT re-implement the validation rules — the server is the
 * authority (`validateBundleSchedule`), and duplicating them here is how the two
 * drift apart. What it does provide is the thing a photographer cannot compute
 * in their head: the effective per-photo price at each threshold, live as they
 * type, so "8 for €20" reads as "€2.50 per photo".
 */
export function BundleTiersField({
  value,
  onChange,
  allPhotosCents,
  onAllPhotosChange,
  pricePerPhoto,
  eventType,
  t,
}: BundleTiersFieldProps) {
  const tiers = value ?? [];
  const isOrganizerEvent = eventType === 'organizer';
  const supported = eventSupportsBundles({ type: eventType, price_per_photo: pricePerPhoto });

  if (!supported) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">{t.laddersHeading}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {isOrganizerEvent ? t.unavailableOrganizer : t.unavailableFree}
        </p>
      </div>
    );
  }

  const update = (index: number, patch: Partial<BundleTier>) => {
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };

  const remove = (index: number) => {
    const next = tiers.filter((_, i) => i !== index);
    // An empty ladder is stored as null, not [] — "no packs" and "a pack list
    // that happens to be empty" must not be two different states.
    onChange(next.length === 0 ? null : next);
  };

  const add = () => {
    const last = tiers[tiers.length - 1];
    // Seed the new rung above the previous one so the default is already a valid
    // ladder rather than something the server will reject.
    const minQuantity = last ? last.minQuantity + 1 : MIN_BUNDLE_TIER_QUANTITY + 1;
    const unitCents = pricePerPhoto ? Math.round(pricePerPhoto * 100) : 0;
    const suggested = Math.max(
      (last?.totalPriceCents ?? 0) + 1,
      Math.round(minQuantity * unitCents * 0.8),
    );
    onChange([...tiers, { minQuantity, totalPriceCents: suggested }]);
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{t.laddersHeading}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.laddersDescription}</p>

      {/* The "all photos" flat price — a CEILING, so it needs no threshold: it
          engages exactly when the per-photo total would exceed it. This is the
          "buy all my photos for one price" offer; the packs below are optional
          steps on the way there. */}
      <div className="mt-4 border-t border-border pt-4">
        <Label htmlFor="bundle_all_photos" className="text-sm font-medium">
          {t.allPhotosLabel}
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">{t.allPhotosDescription}</p>
        <div className="relative mt-2 max-w-[12rem]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {PLATFORM_CURRENCY_SYMBOL}
          </span>
          <Input
            id="bundle_all_photos"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder={t.allPhotosPlaceholder}
            value={allPhotosCents === null ? '' : (allPhotosCents / 100).toFixed(2)}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw.trim() === '') {
                onAllPhotosChange(null);
                return;
              }
              const parsed = Number.parseFloat(raw);
              onAllPhotosChange(Number.isNaN(parsed) ? null : Math.round(parsed * 100));
            }}
            className="pl-7 text-sm"
          />
        </div>
        {allPhotosCents !== null && pricePerPhoto ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t.allPhotosBreakEven.replace(
              '{n}',
              String(Math.ceil(allPhotosCents / Math.round(pricePerPhoto * 100))),
            )}
          </p>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <h4 className="text-sm font-medium">{t.packsHeading}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t.packsDescription}</p>
      </div>

      {tiers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t.noLadder}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {tiers.map((tier, index) => (
            <li
              // Index-keyed on purpose: rungs have no stable id and the threshold
              // is being edited, so keying on it would remount the input
              // mid-keystroke and lose focus.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={index}
              className="flex flex-wrap items-end gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <div className="min-w-[9rem] flex-1">
                <Label className="text-xs text-muted-foreground">{t.minQuantityLabel}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_BUNDLE_TIER_QUANTITY}
                  step={1}
                  value={tier.minQuantity}
                  onChange={(e) =>
                    update(index, { minQuantity: Number.parseInt(e.target.value, 10) || 0 })
                  }
                  className="mt-1"
                />
              </div>
              <div className="min-w-[9rem] flex-1">
                <Label className="text-xs text-muted-foreground">{t.totalPriceLabel}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={(tier.totalPriceCents / 100).toFixed(2)}
                  onChange={(e) =>
                    update(index, {
                      totalPriceCents: Math.round((Number.parseFloat(e.target.value) || 0) * 100),
                    })
                  }
                  className="mt-1"
                />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <span className="text-xs text-muted-foreground">
                  {t.effectivePerPhoto.replace(
                    '{price}',
                    formatCents(getEffectivePerPhotoCents(tier)),
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(index)}
                  aria-label={t.removeTier}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {tiers.length < MAX_BUNDLE_TIERS ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={add}>
          <Plus className="mr-1 h-4 w-4" />
          {t.addTier}
        </Button>
      ) : null}
    </div>
  );
}
