'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { isWatermarkConfigurable } from '@/lib/watermark-policy';
import type { EventForm } from '../wizard-types';

type NewEventT = Dictionary['newEvent'];

type Step2ConfigProps = {
  form: EventForm;
};

/**
 * Step 2 — configuration switches for the chosen event type. Only the toggles
 * relevant to the selected type are shown (visibility/watermark for public
 * events, guest-upload/approval for collaborative, approval for organizer),
 * plus AI matching / bib detection / minors compliance.
 */
export function Step2Config({ form }: Step2ConfigProps) {
  const { t } = useTranslations<NewEventT>();

  return (
    <form.Subscribe selector={(state) => state.values.event_type}>
      {(eventType) => (
        <div className="grid gap-3 md:grid-cols-2">
          {/* Visibility — hidden for organizer (always private). */}
          {eventType !== 'organizer' && (
            <form.Field name="is_public">
              {(field) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                  <div className="grid gap-1">
                    <Label htmlFor="is_public">{t('visibilityLabel')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {field.state.value ? t('visibilityPublicDesc') : t('visibilityPrivateDesc')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {field.state.value ? t('visibilityPublic') : t('visibilityPrivate')}
                    </span>
                    <Switch
                      id="is_public"
                      checked={field.state.value}
                      onCheckedChange={(checked) => {
                        field.handleChange(checked);
                        field.handleBlur();
                        form.setFieldValue('watermark_enabled', checked);
                      }}
                    />
                  </div>
                </div>
              )}
            </form.Field>
          )}

          {/* Same rule as the edit form (T-211): on a private non-organizer
              event the save forces the watermark off, so the switch says so
              instead of offering a preference that vanishes on create. */}
          <form.Subscribe selector={(state) => state.values.is_public}>
            {(isPublic) => {
              const configurable = isWatermarkConfigurable({ eventType, isPublic });
              return (
                <form.Field name="watermark_enabled">
                  {(field) => {
                    const shown = configurable && field.state.value;
                    return (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                        <div className="grid gap-1">
                          <Label htmlFor="watermark_enabled">{t('watermarkLabel')}</Label>
                          <p className="text-xs text-muted-foreground">
                            {configurable ? t('watermarkDesc') : t('watermarkPrivateNote')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {shown ? t('watermarkEnabled') : t('watermarkDisabled')}
                          </span>
                          <Switch
                            id="watermark_enabled"
                            checked={shown}
                            disabled={!configurable}
                            onCheckedChange={(checked) => {
                              field.handleChange(checked);
                              field.handleBlur();
                            }}
                          />
                        </div>
                      </div>
                    );
                  }}
                </form.Field>
              );
            }}
          </form.Subscribe>

          {eventType === 'collaborative' && (
            <>
              <form.Field name="allow_guest_upload">
                {(field) => (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                    <div className="grid gap-1">
                      <Label htmlFor="allow_guest_upload">{t('allowGuestUploadLabel')}</Label>
                      <p className="text-xs text-muted-foreground">{t('allowGuestUploadDesc')}</p>
                    </div>
                    <Switch
                      id="allow_guest_upload"
                      checked={field.state.value}
                      onCheckedChange={(checked) => {
                        field.handleChange(checked);
                        field.handleBlur();
                      }}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="require_upload_approval">
                {(field) => (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                    <div className="grid gap-1">
                      <Label htmlFor="require_upload_approval">{t('requireApprovalLabel')}</Label>
                      <p className="text-xs text-muted-foreground">{t('requireApprovalDesc')}</p>
                    </div>
                    <Switch
                      id="require_upload_approval"
                      checked={field.state.value}
                      onCheckedChange={(checked) => {
                        field.handleChange(checked);
                        field.handleBlur();
                      }}
                    />
                  </div>
                )}
              </form.Field>
            </>
          )}

          {eventType === 'organizer' && (
            <form.Field name="require_upload_approval">
              {(field) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                  <div className="grid gap-1">
                    <Label htmlFor="require_upload_approval">{t('requireApprovalLabel')}</Label>
                    <p className="text-xs text-muted-foreground">{t('organizerApprovalDesc')}</p>
                  </div>
                  <Switch
                    id="require_upload_approval"
                    checked={field.state.value}
                    onCheckedChange={(checked) => {
                      field.handleChange(checked);
                      field.handleBlur();
                    }}
                  />
                </div>
              )}
            </form.Field>
          )}

          <AiMatchingSwitches form={form} />
        </div>
      )}
    </form.Subscribe>
  );
}

/**
 * AI face-matching + bib number detection opt-ins, plus the "contains minors"
 * compliance flag. Enabling minors forces both AI matching and bib detection
 * off (compliance — we don't index faces or scan bibs of children).
 * The minors toggle is editable here during create; in the edit form it
 * becomes read-only.
 */
function AiMatchingSwitches({ form }: { form: EventForm }) {
  const { t } = useTranslations<NewEventT>();
  return (
    <form.Subscribe selector={(state) => state.values.contains_minors}>
      {(containsMinors) => (
        <>
          <form.Field name="ai_matching_enabled">
            {(field) => (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                <div className="grid gap-1">
                  <Label htmlFor="ai_matching_enabled">
                    {t('aiMatchingLabel' as keyof NewEventT)}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {containsMinors
                      ? t('aiMatchingDisabledByMinors' as keyof NewEventT)
                      : t('aiMatchingDesc' as keyof NewEventT)}
                  </p>
                </div>
                <Switch
                  id="ai_matching_enabled"
                  checked={!containsMinors && field.state.value}
                  disabled={containsMinors}
                  onCheckedChange={(checked) => {
                    field.handleChange(checked);
                    field.handleBlur();
                    // Reveal gate needs AI matching as its key — clear it when
                    // AI matching is turned off.
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
                        <Label htmlFor="reveal_gate_enabled">
                          {t('revealGateLabel' as keyof NewEventT)}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {containsMinors
                            ? t('revealGateDisabledByMinors' as keyof NewEventT)
                            : !aiEnabled
                              ? t('revealGateRequiresAi' as keyof NewEventT)
                              : t('revealGateDesc' as keyof NewEventT)}
                        </p>
                      </div>
                      <Switch
                        id="reveal_gate_enabled"
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
                  <Label htmlFor="bib_detection_enabled">
                    {t('bibDetectionLabel' as keyof NewEventT)}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {containsMinors
                      ? t('bibDetectionDisabledByMinors' as keyof NewEventT)
                      : t('bibDetectionDesc' as keyof NewEventT)}
                  </p>
                </div>
                <Switch
                  id="bib_detection_enabled"
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
          <form.Field name="contains_minors">
            {(field) => (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                <div className="grid gap-1">
                  <Label htmlFor="contains_minors">
                    {t('containsMinorsLabel' as keyof NewEventT)}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('containsMinorsDesc' as keyof NewEventT)}
                  </p>
                </div>
                <Switch
                  id="contains_minors"
                  checked={field.state.value}
                  onCheckedChange={(checked) => {
                    field.handleChange(checked);
                    field.handleBlur();
                    if (checked) {
                      // Hard-pair: enabling minors clears AI matching, bib
                      // detection, and the reveal gate (all need AI / are
                      // unavailable for minors).
                      form.setFieldValue('ai_matching_enabled', false);
                      form.setFieldValue('bib_detection_enabled', false);
                      form.setFieldValue('reveal_gate_enabled', false);
                    }
                  }}
                />
              </div>
            )}
          </form.Field>
        </>
      )}
    </form.Subscribe>
  );
}
