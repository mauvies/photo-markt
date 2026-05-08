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

interface EventShareCodeProps {
  shareCode: string;
  eventName: string;
  /** Optional override for the section heading (e.g. "Share to invite contributors") */
  label?: string;
}

export function EventShareCode({ shareCode, eventName, label }: EventShareCodeProps) {
  const [copied, setCopied] = useState(false);
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/events/${shareCode}` : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="rounded-lg border border-input bg-card p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{label ?? 'Share Code'}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Share this code with people who should have access to "{eventName}"
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-lg font-semibold tracking-wider">
          {shareCode}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
          <Copy className="h-4 w-4 mr-2" />
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>

      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="w-full">
            <QrCode className="h-4 w-4 mr-2" />
            Show QR Code
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Event</DialogTitle>
            <DialogDescription>Scan this QR code to share the event access code</DialogDescription>
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
              <p className="text-sm font-mono font-semibold">{shareCode}</p>
              <p className="text-xs text-muted-foreground mt-1">Or share the code directly</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
