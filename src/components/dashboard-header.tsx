'use client';

import type { ReactNode } from 'react';

export function DashboardHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-4xl font-bold">{title}</h1>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
