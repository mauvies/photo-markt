'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { cn } from '@/lib/utils';
import { AIMatchingModal } from './ai-matching-modal';

export function AIMatchingButton({ className }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const isEnabled = isFeatureEnabled('AI_MATCHING');

  if (!isEnabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block">
              <Button disabled className={cn('gap-2', className)} variant="default" size="sm">
                <Sparkles className="h-4 w-4" />
                Find My Photos
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Coming soon</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} className={cn('gap-2', className)} variant="default">
        <Sparkles className="h-4 w-4" />
        Find My Photos
      </Button>
      <AIMatchingModal open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}
