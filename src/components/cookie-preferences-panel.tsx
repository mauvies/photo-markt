'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { CookieConsent } from '@/lib/cookie-consent';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

/**
 * Granular cookie preferences. Modeled as a Dialog so focus trapping, Escape,
 * and the accessible dialog role come from Radix. "Necessary" is shown as an
 * always-on, locked row (informational); only non-essential categories
 * (currently just analytics) are toggleable. The category list is data-driven
 * so adding a category later is a copy + a config entry, not a re-layout.
 */
export function CookiePreferencesPanel({
  open,
  onOpenChange,
  dict,
  initial,
  onSave,
  onAcceptAll,
  onRejectAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dict: Dictionary['cookieConsent'];
  initial: CookieConsent;
  onSave: (consent: CookieConsent) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  const [analytics, setAnalytics] = useState(initial.analytics);

  // Re-sync local toggle state whenever the panel is (re)opened, so it reflects
  // the latest persisted choice rather than a stale render.
  useEffect(() => {
    if (open) setAnalytics(initial.analytics);
  }, [open, initial.analytics]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[80] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dict.manageTitle}</DialogTitle>
          <DialogDescription>{dict.manageDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col divide-y divide-border">
          {/* Necessary — always on, locked */}
          <div className="flex items-start justify-between gap-4 py-4">
            <div className="text-sm">
              <p className="font-medium text-foreground">{dict.necessaryTitle}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {dict.necessaryDescription}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">{dict.alwaysOn}</span>
              <Switch checked disabled aria-label={dict.necessaryTitle} />
            </div>
          </div>

          {/* Analytics — toggleable */}
          <div className="flex items-start justify-between gap-4 py-4">
            <div className="text-sm">
              <p className="font-medium text-foreground">{dict.analyticsTitle}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {dict.analyticsDescription}
              </p>
            </div>
            <Switch
              checked={analytics}
              onCheckedChange={setAnalytics}
              aria-label={dict.analyticsTitle}
              className="mt-0.5 shrink-0"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onRejectAll}>
            {dict.reject}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onAcceptAll}>
              {dict.accept}
            </Button>
            <Button size="sm" onClick={() => onSave({ analytics })}>
              {dict.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
