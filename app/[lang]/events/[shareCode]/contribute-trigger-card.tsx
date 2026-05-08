'use client';

import { ImagePlus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

type ContributeTriggerCardProps = {
  title: string;
  description: string;
  buttonLabel: string;
};

/**
 * Card with copy on the left and a trigger button on the right that opens
 * the contribute modal by adding `?contribute=1` to the URL. Using the
 * router (instead of a plain Link) lets us preserve any existing query
 * params and avoid a full navigation flicker.
 */
export function ContributeTriggerCard({
  title,
  description,
  buttonLabel,
}: ContributeTriggerCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('contribute', '1');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-input bg-card p-4 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold md:text-lg">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button type="button" onClick={handleClick} className="shrink-0">
        <ImagePlus className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>
    </div>
  );
}
