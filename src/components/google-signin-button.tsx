'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { signInWithGoogle } from '@/app/auth/google/actions';
import { Button } from '@/components/ui/button';

interface GoogleSignInButtonProps {
  plan?: string;
  /**
   * Billing period to forward through the OAuth flow → settings's UpgradeHandler.
   * Only relevant when `plan` is also set (post-signup checkout flow).
   */
  period?: string;
  next?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'link' | 'destructive' | 'secondary';
  className?: string;
  label?: string;
}

export function GoogleSignInButton({
  plan,
  period,
  next,
  variant = 'outline',
  className,
  label,
}: GoogleSignInButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const result = await signInWithGoogle(plan, next, period);
      const nextSuffix = next ? `&next=${encodeURIComponent(next)}` : '';
      if (result.error) {
        router.push(
          `/login?message=Could not sign in with Google. Reason: ${result.error}${nextSuffix}`,
        );
      } else if (result.url) {
        window.location.href = result.url;
      } else {
        router.push(`/login?message=Failed to initiate Google sign-in${nextSuffix}`);
      }
    });
  };

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={handleClick}
      disabled={isPending}
    >
      <div className="flex justify-between gap-3 items-center">
        <Image src="/google.svg" alt="Google" width={25} height={25} />
        {label && <span>{label}</span>}
      </div>
    </Button>
  );
}
