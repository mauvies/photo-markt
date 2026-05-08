'use client';

import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      duration={4000}
      gap={10}
      offset={16}
      mobileOffset={16}
      style={
        {
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
