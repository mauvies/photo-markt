'use client';

import { Camera, Lock, Users } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import type { EventType } from '../wizard.schema';
import type { EventForm } from '../wizard-types';

type NewEventT = Dictionary['newEvent'];

type Step1ConfigProps = {
  form: EventForm;
};

export function Step1Config({ form }: Step1ConfigProps) {
  const { t } = useTranslations<NewEventT>();

  return (
    <div className="grid gap-4">
      <form.Field name="event_type">
        {(field) => (
          <div className="grid gap-2">
            <Label>{t('eventTypeLabel')}</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              <EventTypeCard
                type="solo"
                icon={<Camera className="h-5 w-5" />}
                title={t('eventTypeSolo')}
                description={t('eventTypeSoloDesc')}
                selected={field.state.value === 'solo'}
                onSelect={() => selectType(form, 'solo')}
              />
              <EventTypeCard
                type="collaborative"
                icon={<Users className="h-5 w-5" />}
                title={t('eventTypeCollaborative')}
                description={t('eventTypeCollaborativeDesc')}
                selected={field.state.value === 'collaborative'}
                onSelect={() => selectType(form, 'collaborative')}
              />
              <EventTypeCard
                type="organizer"
                icon={<Lock className="h-5 w-5" />}
                title={t('eventTypeOrganizer')}
                description={t('eventTypeOrganizerDesc')}
                selected={field.state.value === 'organizer'}
                onSelect={() => selectType(form, 'organizer')}
              />
            </div>
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.event_type}>
        {(eventType) => (
          <div className="grid gap-3">
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

            <form.Field name="watermark_enabled">
              {(field) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                  <div className="grid gap-1">
                    <Label htmlFor="watermark_enabled">{t('watermarkLabel')}</Label>
                    <p className="text-xs text-muted-foreground">{t('watermarkDesc')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {field.state.value ? t('watermarkEnabled') : t('watermarkDisabled')}
                    </span>
                    <Switch
                      id="watermark_enabled"
                      checked={field.state.value}
                      onCheckedChange={(checked) => {
                        field.handleChange(checked);
                        field.handleBlur();
                      }}
                    />
                  </div>
                </div>
              )}
            </form.Field>

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
          </div>
        )}
      </form.Subscribe>
    </div>
  );
}

// Apply the side effects of switching event type. Each transition adjusts the
// dependent flags so the rest of the form stays internally consistent without
// the user having to clean up after themselves.
function selectType(form: EventForm, type: EventType) {
  form.setFieldValue('event_type', type);
  form.setFieldValue('is_collaborative', type === 'collaborative');

  if (type === 'solo') {
    form.setFieldValue('allow_guest_upload', false);
  } else if (type === 'collaborative') {
    // Default to private + free + no watermark — the typical "share with the
    // group" use case. Owner can override these below.
    form.setFieldValue('is_public', false);
    form.setFieldValue('watermark_enabled', false);
    form.setFieldValue('price_per_photo', null);
    form.setFieldValue('allow_guest_upload', true);
    form.setFieldValue('organizer_fee_per_photo', null);
  } else {
    // Organizer: invite-only, no public access, no anonymous guest uploads.
    form.setFieldValue('is_public', false);
    form.setFieldValue('allow_guest_upload', false);
    form.setFieldValue('price_per_photo', null);
  }
}

type EventTypeCardProps = {
  type: EventType;
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
};

function EventTypeCard({ type, icon, title, description, selected, onSelect }: EventTypeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'group flex h-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-input hover:border-primary/50 hover:bg-muted/40',
      ].join(' ')}
      data-event-type={type}
    >
      <div className="flex items-center gap-2">
        <span
          className={[
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
            selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          ].join(' ')}
        >
          {icon}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
