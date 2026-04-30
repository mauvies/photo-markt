'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { createBillingCheckoutAction } from '@/app/[lang]/dashboard/photographer/billing/actions';
import { Button } from '@/components/ui/button';

interface PricingPlanButtonProps {
  planId: 'free' | 'starter' | 'pro';
  isFree: boolean;
  isAuthenticated?: boolean;
  label: string;
  loadingLabel: string;
  className?: string;
}

export function PricingPlanButton({
  planId,
  isFree,
  isAuthenticated = false,
  label,
  loadingLabel,
  className,
}: PricingPlanButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isStarter = planId === 'starter';

  if (isFree) {
    return (
      <Link href="/signup" className={className}>
        <Button
          variant="outline"
          size="lg"
          className="w-full justify-center gap-2 text-sm font-medium tracking-tight"
        >
          {label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    );
  }

  const buttonClassName = [
    'w-full justify-center gap-2 text-sm font-medium tracking-tight',
    isStarter
      ? 'bg-gradient-starter text-white hover:opacity-90 transition-opacity'
      : 'bg-primary text-primary-foreground hover:bg-primary/90',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!isAuthenticated) {
    return (
      <Link href={`/signup?plan=${planId}`} className={className}>
        <Button variant="default" size="lg" className={buttonClassName}>
          {label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    );
  }

  const handleUpgrade = () => {
    startTransition(async () => {
      try {
        const result = await createBillingCheckoutAction(planId as 'starter' | 'pro');
        if ('url' in result) {
          window.location.href = result.url;
        } else if (result.updated) {
          router.push('/dashboard/photographer/settings?updated=true');
        }
      } catch (error) {
        console.error('Checkout error:', error);
        router.push(`/signup?plan=${planId}`);
      }
    });
  };

  return (
    <Button
      variant="default"
      size="lg"
      onClick={handleUpgrade}
      disabled={isPending}
      className={buttonClassName}
    >
      {isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="h-4 w-4" />
        </>
      )}
    </Button>
  );
}
