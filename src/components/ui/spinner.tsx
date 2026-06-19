import { Loader2Icon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Spinner({ className, ...props }: React.ComponentProps<'output'>) {
  return (
    <output
      aria-live="polite"
      className={cn('flex min-h-[60dvh] w-full items-center justify-center', className)}
      {...props}
    >
      <Loader2Icon aria-hidden="true" focusable="false" className="size-6 animate-spin" />
      <span className="sr-only">Loading</span>
    </output>
  );
}

export { Spinner };
