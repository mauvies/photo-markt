'use client';

import { useForm } from '@tanstack/react-form';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';

const profileSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(
      /^[a-z0-9_-]+$/,
      'Username can only contain lowercase letters, numbers, underscores, and hyphens',
    ),
  display_name: z.string().trim().max(100, 'Display name is too long').optional(),
  bio: z.string().trim().max(500, 'Bio is too long').optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

type ProfileFormT = Dictionary['profileForm'];

interface ProfileFormProps {
  initialValues: {
    username: string;
    display_name?: string | null;
    bio?: string | null;
  };
  onSubmit: (values: ProfileFormValues) => Promise<void>;
  isPending?: boolean;
}

export function ProfileForm({
  initialValues,
  onSubmit,
  isPending: externalIsPending,
}: ProfileFormProps) {
  const router = useRouter();
  const { t } = useTranslations<ProfileFormT>();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const form = useForm({
    defaultValues: {
      username: initialValues.username || '',
      display_name: initialValues.display_name || '',
      bio: initialValues.bio || '',
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      startTransition(async () => {
        try {
          // Validate with zod
          const parsed = profileSchema.parse(value);
          await onSubmit(parsed);
          router.refresh();
        } catch (error) {
          if (error instanceof z.ZodError) {
            setSubmitError(error.issues[0]?.message || 'Validation failed');
          } else {
            setSubmitError(error instanceof Error ? error.message : 'Failed to update profile');
          }
        }
      });
    },
  });

  const handleUsernameChange = (value: string) => {
    // Convert to lowercase and replace invalid characters
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 30);
    return normalized;
  };

  const isFormPending = externalIsPending ?? isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSubmitAttempted(true);
        form.handleSubmit();
      }}
      className="space-y-6"
    >
      {/* Username */}
      <form.Field
        name="username"
        validators={{
          onChange: ({ value }) => {
            const result = profileSchema.shape.username.safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const usernameError =
            submitAttempted && field.state.meta.errors.length > 0
              ? field.state.meta.errors[0]
              : null;
          return (
            <div className="grid gap-2">
              <Label htmlFor={field.name}>
                {t('username')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onChange={(e) => {
                  const normalized = handleUsernameChange(e.target.value);
                  field.handleChange(normalized);
                }}
                onBlur={field.handleBlur}
                placeholder="johndoe"
                aria-invalid={submitAttempted && !!usernameError}
                className={cn(submitAttempted && usernameError && 'border-destructive')}
                disabled={isFormPending}
              />
              <p className="text-xs text-muted-foreground">
                {t('usernameDesc')} (e.g., @{field.state.value || 'username'}).
              </p>
              {usernameError ? <p className="text-xs text-destructive">{usernameError}</p> : null}
            </div>
          );
        }}
      </form.Field>

      {/* Display Name */}
      <form.Field
        name="display_name"
        validators={{
          onChange: ({ value }) => {
            const result = profileSchema.shape.display_name.safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const displayNameError =
            submitAttempted && field.state.meta.errors.length > 0
              ? field.state.meta.errors[0]
              : null;
          return (
            <div className="grid gap-2">
              <Label htmlFor={field.name}>{t('displayName')}</Label>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="John Doe"
                aria-invalid={submitAttempted && !!displayNameError}
                className={cn(submitAttempted && displayNameError && 'border-destructive')}
                disabled={isFormPending}
              />
              <p className="text-xs text-muted-foreground">{t('displayNameDesc')}</p>
              {displayNameError ? (
                <p className="text-xs text-destructive">{displayNameError}</p>
              ) : null}
            </div>
          );
        }}
      </form.Field>

      {/* Bio */}
      <form.Field
        name="bio"
        validators={{
          onChange: ({ value }) => {
            const result = profileSchema.shape.bio.safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const bioError =
            submitAttempted && field.state.meta.errors.length > 0
              ? field.state.meta.errors[0]
              : null;
          return (
            <div className="grid gap-2">
              <Label htmlFor={field.name}>{t('bio')}</Label>
              <Textarea
                id={field.name}
                name={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('bioPlaceholder')}
                rows={4}
                aria-invalid={submitAttempted && !!bioError}
                className={cn(submitAttempted && bioError && 'border-destructive')}
                disabled={isFormPending}
              />
              <p className="text-xs text-muted-foreground">
                {field.state.value.length}/500 characters
              </p>
              {bioError ? <p className="text-xs text-destructive">{bioError}</p> : null}
            </div>
          );
        }}
      </form.Field>

      {/* Error Message */}
      {submitError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{submitError}</p>
        </div>
      ) : null}

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button type="submit" disabled={isFormPending}>
          {isFormPending ? t('saving') : t('saveChanges')}
        </Button>
      </div>
    </form>
  );
}
