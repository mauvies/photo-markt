'use client';

import { useForm } from '@tanstack/react-form';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { updatePasswordAction } from './actions';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

interface PasswordRequirementProps {
  met: boolean;
  children: React.ReactNode;
}

function PasswordRequirement({ met, children }: PasswordRequirementProps) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 text-sm',
        met ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
      )}
    >
      <span className={cn('text-xs', met ? 'text-green-600' : 'text-muted-foreground')}>
        {met ? '✓' : '○'}
      </span>
      {children}
    </li>
  );
}

function getPasswordRequirements(password: string) {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
}

export function ResetPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const form = useForm({
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      startTransition(async () => {
        try {
          // Validate with zod
          const parsed = resetPasswordSchema.parse(value);

          // Create FormData for server action
          const formData = new FormData();
          formData.append('password', parsed.password);
          formData.append('confirmPassword', parsed.confirmPassword);

          await updatePasswordAction(formData);
        } catch (error) {
          if (error instanceof z.ZodError) {
            // Set field-specific errors
            const firstError = error.issues[0];
            if (firstError?.path[0] === 'confirmPassword') {
              form.setFieldMeta('confirmPassword', (prev) => ({
                ...prev,
                errors: [firstError.message],
              }));
            } else {
              setSubmitError(firstError?.message || 'Validation failed');
            }
          } else {
            setSubmitError(error instanceof Error ? error.message : 'Failed to update password');
          }
        }
      });
    },
  });

  const [passwordValue, setPasswordValue] = useState('');
  const passwordRequirements = getPasswordRequirements(passwordValue);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSubmitAttempted(true);
        form.handleSubmit();
      }}
      className="mt-6 animate-in flex w-full flex-col justify-center gap-4"
    >
      {submitError && (
        <div className="rounded-lg border border-red-500 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-400">
          {submitError}
        </div>
      )}

      {/* Password Field */}
      <form.Field
        name="password"
        validators={{
          onChange: ({ value }) => {
            setPasswordValue(value);
            const result = passwordSchema.safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const passwordError =
            submitAttempted && field.state.meta.errors.length > 0
              ? field.state.meta.errors[0]
              : null;

          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>New Password</Label>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="••••••••"
                aria-invalid={submitAttempted && !!passwordError}
                className={cn(
                  'rounded-full border bg-inherit px-4 h-10',
                  submitAttempted && passwordError && 'border-red-500',
                )}
                disabled={isPending}
              />
              {passwordValue && (
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Password requirements:
                  </p>
                  <ul className="space-y-1">
                    <PasswordRequirement met={passwordRequirements.minLength}>
                      At least 8 characters
                    </PasswordRequirement>
                    <PasswordRequirement met={passwordRequirements.hasUppercase}>
                      One uppercase letter
                    </PasswordRequirement>
                    <PasswordRequirement met={passwordRequirements.hasLowercase}>
                      One lowercase letter
                    </PasswordRequirement>
                    <PasswordRequirement met={passwordRequirements.hasNumber}>
                      One number
                    </PasswordRequirement>
                    <PasswordRequirement met={passwordRequirements.hasSpecial}>
                      One special character
                    </PasswordRequirement>
                  </ul>
                </div>
              )}
              {passwordError && (
                <p className="text-xs text-red-600 dark:text-red-400">{passwordError}</p>
              )}
            </div>
          );
        }}
      </form.Field>

      {/* Confirm Password Field */}
      <form.Field
        name="confirmPassword"
        validators={{
          onChange: ({ value }) => {
            const password = form.getFieldValue('password');
            if (!value) {
              return 'Please confirm your password';
            }
            if (value !== password) {
              return 'Passwords do not match';
            }
            return undefined;
          },
        }}
      >
        {(field) => {
          const confirmError =
            submitAttempted && field.state.meta.errors.length > 0
              ? field.state.meta.errors[0]
              : null;

          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Confirm Password</Label>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="••••••••"
                aria-invalid={submitAttempted && !!confirmError}
                className={cn(
                  'rounded-full border bg-inherit px-4 h-10 placeholder:text-muted-foreground/30',
                  submitAttempted && confirmError && 'border-red-500',
                )}
                disabled={isPending}
              />
              {confirmError && (
                <p className="text-xs text-red-600 dark:text-red-400">{confirmError}</p>
              )}
            </div>
          );
        }}
      </form.Field>

      <Button type="submit" disabled={isPending} className="mb-2 h-10 w-full">
        {isPending ? 'Updating...' : 'Update Password'}
      </Button>
    </form>
  );
}
