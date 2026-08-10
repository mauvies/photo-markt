'use client';

import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';
import { useAuthUser } from '@/hooks/use-auth-user';
import { useIsMobile } from '@/hooks/use-mobile';

export function Toaster(props: ToasterProps) {
  const isMobile = useIsMobile();
  // On mobile, placement depends on auth state. Authenticated viewers have the
  // fixed bottom nav (and its "Ver carrito" action), which a bottom toast would
  // cover — so they get a top toast. Unauthenticated viewers have no bottom nav,
  // so bottom is the better, less intrusive placement for them. `user` is
  // `undefined` until auth resolves; treat that window as authenticated so we
  // never risk covering a nav that may be there. Desktop keeps bottom-right.
  const { user } = useAuthUser();
  const mobilePosition = user === null ? 'bottom-center' : 'top-center';

  return (
    <SonnerToaster
      position={isMobile ? mobilePosition : 'bottom-right'}
      closeButton
      duration={4000}
      gap={10}
      offset={16}
      mobileOffset={16}
      style={
        {
          // Radix's modal Dialog (`disableOutsidePointerEvents`, the default
          // for `modal={true}`) sets `document.body.style.pointerEvents =
          // 'none'` while open, to make everything outside the dialog
          // unclickable — and re-enables `auto` only on ITS OWN layer. The
          // Toaster is a sibling in `[lang]/layout.tsx`, outside Radix's
          // component tree entirely, so with no override it inherits that
          // `none` and the whole toast — including "View cart" — becomes
          // unclickable for as long as any modal Dialog is open: a click at
          // its position falls through to the (`pointer-events: auto`)
          // overlay behind it, which is exactly what closes the dialog.
          // `pointer-events` is inheritable but any descendant can override
          // it regardless of what an ancestor set, so pinning it back to
          // `auto` here — closer to the toast than `body` — restores
          // clickability without touching Radix's protection for the rest
          // of the page (T-241).
          pointerEvents: 'auto',
          '--toast-close-button-start': 'auto',
          '--toast-close-button-end': '12px',
          '--toast-close-button-transform': 'none',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-lg !p-4 !pr-12 !font-sans !items-center',
          title: '!font-medium !text-sm !text-popover-foreground !leading-5',
          description: '!text-sm !text-muted-foreground !leading-5',
          icon: '!text-foreground',
          closeButton:
            '!top-4 !h-5 !w-5 !rounded-full !border !border-border !bg-background !text-muted-foreground hover:!bg-accent hover:!text-accent-foreground !transition-colors !opacity-100',
          success: '!text-popover-foreground',
          error: '!text-destructive',
          warning: '!text-popover-foreground',
          info: '!text-popover-foreground',
          actionButton: '!rounded-full !bg-primary !text-primary-foreground !text-xs !font-medium',
          cancelButton:
            '!rounded-full !bg-muted !text-muted-foreground !text-xs !font-medium hover:!bg-accent',
        },
      }}
      {...props}
    />
  );
}
