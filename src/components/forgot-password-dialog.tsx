'use client';

import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { resetPasswordAction } from '@/app/[lang]/login/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';

type AuthT = Dictionary['auth'];

interface ForgotPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail?: string;
}

export function ForgotPasswordDialog({
  open,
  onOpenChange,
  initialEmail = '',
}: ForgotPasswordDialogProps) {
  const { t } = useTranslations<AuthT>();
  const [email, setEmail] = useState(initialEmail);
  const [isPending, startTransition] = useTransition();
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update email when initialEmail changes (when dialog opens)
  useEffect(() => {
    if (open && initialEmail) {
      setEmail(initialEmail);
    }
  }, [open, initialEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email) {
      setError(t('errorEnterEmail'));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('errorValidEmail'));
      return;
    }

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('email', email);
        await resetPasswordAction(formData);
        setIsSuccess(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('somethingWentWrong'));
      }
    });
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after a delay to allow animation
    setTimeout(() => {
      setIsSuccess(false);
      setError(null);
      setEmail(initialEmail);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {!isSuccess ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/20">
                <Mail className="h-6 w-6 text-sky-600 dark:text-sky-400" />
              </div>
              <DialogTitle className="text-center text-2xl">{t('resetPasswordTitle')}</DialogTitle>
              <DialogDescription className="text-center">
                {t('resetPasswordDesc')}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">{t('emailAddress')}</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  disabled={isPending}
                  autoFocus
                  className="h-11"
                  required
                />
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <Button type="submit" disabled={isPending} className="h-11 w-full">
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('sending')}
                    </>
                  ) : (
                    t('sendResetLink')
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClose}
                  disabled={isPending}
                  className="h-10"
                >
                  {t('cancel')}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <DialogTitle className="text-center text-2xl">{t('checkYourEmail')}</DialogTitle>
              <DialogDescription className="text-center">
                {t('resetLinkSentTo')} <span className="font-medium text-foreground">{email}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">{t('didntReceiveEmail')}</p>
              </div>
              <Button onClick={handleClose} className="h-11 w-full" variant="outline">
                {t('backToLogin')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
