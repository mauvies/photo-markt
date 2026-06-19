'use client';

import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CopyLinkButtonProps = {
  /** The string written to the clipboard. */
  value: string;
  /** Default state label (e.g. "Copy profile link"). */
  copyLabel: string;
  /** Confirmation label shown for ~2s after a successful copy. */
  copiedLabel: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
};

/**
 * Small client component for copy-to-clipboard URLs. Mirrors the pattern in
 * `components/event-share-code.tsx`: local `copied` flag, 2s reset, icon
 * swap between `<Copy />` and `<Check />`. Falls back silently when the
 * Clipboard API is unavailable (e.g. insecure context).
 */
export function CopyLinkButton({
  value,
  copyLabel,
  copiedLabel,
  className,
  variant = 'outline',
  size = 'sm',
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write may fail in restricted contexts; the user can still
      // long-press the URL in the address bar as a fallback.
    }
  }, [value]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleCopy}
      className={cn(className)}
      aria-label={copied ? copiedLabel : copyLabel}
    >
      {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
      {copied ? copiedLabel : copyLabel}
    </Button>
  );
}
