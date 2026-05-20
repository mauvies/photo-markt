'use client';

import { Copy, QrCode } from 'lucide-react';
import { useState } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

interface EventShareCodeProps {
  shareCode: string;
  eventName: string;
  /** Translated copy for the share section + QR modal. */
  t: Dictionary['shareEvent'];
  /** Optional override for the section heading (e.g. "Share to invite contributors"). */
  label?: string;
}

export function EventShareCode({ shareCode, eventName, t, label }: EventShareCodeProps) {
  // Which button last copied — drives its transient "Copied!" confirmation.
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/events/${shareCode}` : '';

  const copy = async (text: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{label ?? t.heading}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.description.replace('{eventName}', eventName)}
        </p>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-lg font-semibold tracking-wider">
          {shareCode}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => copy(shareCode, 'code')}
          className="shrink-0"
        >
          <Copy className="mr-2 h-4 w-4" />
          {copied === 'code' ? t.copyCodeDone : t.copyCode}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" onClick={() => copy(shareUrl, 'link')}>
          <Copy className="mr-2 h-4 w-4" />
          {copied === 'link' ? t.copyLinkDone : t.copyLink}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              <QrCode className="mr-2 h-4 w-4" />
              {t.showQr}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t.qrTitle}</DialogTitle>
              <DialogDescription>{t.qrDescription}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="rounded-lg border border-input bg-white p-4">
                <QRCode
                  value={shareUrl || shareCode}
                  size={256}
                  style={{ height: 'auto', maxWidth: '100%', width: '100%' }}
                  viewBox="0 0 256 256"
                />
              </div>
              <div className="text-center">
                <p className="font-mono text-sm font-semibold">{shareCode}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.qrFooter}</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
