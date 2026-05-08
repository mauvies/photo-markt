'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { ContributeSection } from './contribute-section';

const MODAL_PARAM = 'contribute';

type CollaborativeT = Dictionary['collaborativeEvent'];

type ContributeModalProps = {
  shareCode: string;
  isAuthenticated: boolean;
  requireApproval: boolean;
  t: CollaborativeT;
};

export function ContributeModal({
  shareCode,
  isAuthenticated,
  requireApproval,
  t,
}: ContributeModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isOpen = searchParams.get(MODAL_PARAM) === '1';

  const close = useCallback(() => {
    // Drop the query param. router.back() would also close on mobile, but
    // using replace keeps the page state without an extra history entry
    // when the user closes via Esc / overlay click / successful upload.
    const params = new URLSearchParams(searchParams.toString());
    params.delete(MODAL_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) return; // opening is driven by the trigger link, not this handler
      close();
    },
    [close],
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.uploadHeading}</DialogTitle>
          <DialogDescription>
            {requireApproval ? t.uploadDescPending : t.uploadDesc}
          </DialogDescription>
        </DialogHeader>
        <ContributeSection
          shareCode={shareCode}
          isAuthenticated={isAuthenticated}
          requireApproval={requireApproval}
          t={t}
          embedded
          onSuccess={close}
        />
      </DialogContent>
    </Dialog>
  );
}
