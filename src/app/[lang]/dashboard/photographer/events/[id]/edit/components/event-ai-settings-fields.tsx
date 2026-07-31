'use client';

import type { ReactFormExtendedApi } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import type { FormValues } from '../edit-event-schema';

// biome-ignore format: keep on one line so the single lint suppression below covers all type params
// biome-ignore lint/suspicious/noExplicitAny: TanStack Form has invariant variance on all 12 generic params; using `any` avoids re-deriving exact param types from the call site
type FormInstance = ReactFormExtendedApi<FormValues, any, any, any, any, any, any, any, any, any, any, any>;

/**
 * The AI-matching / reveal-gate / bib-detection / contains-minors settings
 * block. Extracted from the full edit form (T-179 follow-up) so both the full
 * edit page and the section-scoped "settings" edit page render the exact same
 * controls with the same cross-field rules (minors disables AI/bib/reveal; the
 * reveal gate requires AI matching; contains_minors is read-only post-creation).
 */
export function EventAiSettingsFields({ form }: { form: FormInstance }) {
  const { t } = useTranslations<Dictionary['newEvent']>();

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <form.Subscribe selector={(state) => state.values.contains_minors}>
        {(containsMinors) => (
          <>
            <form.Field name="ai_matching_enabled">
              {(field) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                  <div className="grid gap-1">
                    <Label htmlFor="edit_ai_matching_enabled">{t('aiMatchingLabel')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {containsMinors ? t('aiMatchingDisabledByMinors') : t('aiMatchingDesc')}
                    </p>
                  </div>
                  <Switch
                    id="edit_ai_matching_enabled"
                    checked={!containsMinors && field.state.value}
                    disabled={containsMinors}
                    onCheckedChange={(checked) => {
                      field.handleChange(checked);
                      field.handleBlur();
                      if (!checked) form.setFieldValue('reveal_gate_enabled', false);
                    }}
                  />
                </div>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.ai_matching_enabled}>
              {(aiEnabled) => (
                <form.Field name="reveal_gate_enabled">
                  {(field) => {
                    const available = !containsMinors && aiEnabled;
                    return (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                        <div className="grid gap-1">
                          <Label htmlFor="edit_reveal_gate_enabled">{t('revealGateLabel')}</Label>
                          <p className="text-xs text-muted-foreground">
                            {containsMinors
                              ? t('revealGateDisabledByMinors')
                              : !aiEnabled
                                ? t('revealGateRequiresAi')
                                : t('revealGateDesc')}
                          </p>
                        </div>
                        <Switch
                          id="edit_reveal_gate_enabled"
                          checked={available && field.state.value}
                          disabled={!available}
                          onCheckedChange={(checked) => {
                            field.handleChange(checked);
                            field.handleBlur();
                          }}
                        />
                      </div>
                    );
                  }}
                </form.Field>
              )}
            </form.Subscribe>
            <form.Field name="bib_detection_enabled">
              {(field) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                  <div className="grid gap-1">
                    <Label htmlFor="edit_bib_detection_enabled">{t('bibDetectionLabel')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {containsMinors ? t('bibDetectionDisabledByMinors') : t('bibDetectionDesc')}
                    </p>
                  </div>
                  <Switch
                    id="edit_bib_detection_enabled"
                    checked={!containsMinors && field.state.value}
                    disabled={containsMinors}
                    onCheckedChange={(checked) => {
                      field.handleChange(checked);
                      field.handleBlur();
                    }}
                  />
                </div>
              )}
            </form.Field>
            {/* `contains_minors` is read-only after event creation. */}
            <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3 opacity-90">
              <div className="grid gap-1">
                <Label htmlFor="edit_contains_minors">{t('containsMinorsLabel')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('containsMinorsImmutableHelper')}
                </p>
              </div>
              <Switch id="edit_contains_minors" checked={containsMinors} disabled />
            </div>
          </>
        )}
      </form.Subscribe>
    </div>
  );
}
