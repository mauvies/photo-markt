'use client';

import { Crown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface EventLimitReachedDialogProps {
  current: number;
  max: number;
  planName: string;
  upgradeHref: string;
  t: {
    title: string;
    /** Template with `{planName}`, `{current}`, `{max}` placeholders. */
    body: string;
    upgradeCta: string;
    closeLabel: string;
  };
}

export function EventLimitReachedDialog({
  current,
  max,
  planName,
  upgradeHref,
  t,
}: EventLimitReachedDialogProps) {
  const [open, setOpen] = useState(true);

  const body = t.body
    .replace('{planName}', planName)
    .replace('{current}', String(current))
    .replace('{max}', String(max));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:items-start sm:text-left">
          <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Crown className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => setOpen(false)} className="sm:order-1">
            {t.closeLabel}
          </Button>
          <Link href={upgradeHref} className={buttonVariants({ className: 'sm:order-2' })}>
            {t.upgradeCta}
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
