'use client';

import { useState } from 'react';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { ForgotPasswordDialog } from './forgot-password-dialog';

type AuthT = Dictionary['auth'];

export function ForgotPasswordLink({ emailId }: { emailId: string }) {
  const { t } = useTranslations<AuthT>();
  const [open, setOpen] = useState(false);
  const [initialEmail, setInitialEmail] = useState('');

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Get email value when dialog opens
    const emailInput = document.getElementById(emailId) as HTMLInputElement;
    setInitialEmail(emailInput?.value || '');
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="text-sm  text-sky-600 hover:text-sky-700 hover:underline dark:text-sky-400 dark:hover:text-sky-300"
      >
        {t('forgotPassword')}
      </button>
      <ForgotPasswordDialog open={open} onOpenChange={setOpen} initialEmail={initialEmail} />
    </>
  );
}
