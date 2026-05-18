import { Calendar, ImageIcon, Plus, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, body, ctaLabel, ctaHref, compact }: EmptyStateProps) {
  return (
    <div
      className={
        compact
          ? 'flex flex-col items-center justify-center rounded-xl border border-dashed py-8 text-center'
          : 'flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center sm:py-16'
      }
    >
      <div className="mb-4 rounded-full bg-muted p-3">{icon}</div>
      <h3 className="text-base font-semibold sm:text-lg">{title}</h3>
      <p className="mt-2 mb-4 max-w-sm px-4 text-sm text-muted-foreground">{body}</p>
      {ctaLabel && ctaHref ? (
        <Link href={ctaHref}>
          <Button>{ctaLabel}</Button>
        </Link>
      ) : null}
    </div>
  );
}

interface WelcomeEmptyProps {
  lang: string;
  t: {
    title: string;
    body: string;
    ctaLabel: string;
  };
}

export function WelcomeEmpty({ lang, t }: WelcomeEmptyProps) {
  return (
    <EmptyState
      icon={<Plus className="h-6 w-6 text-muted-foreground" aria-hidden />}
      title={t.title}
      body={t.body}
      ctaLabel={t.ctaLabel}
      ctaHref={`/${lang}/dashboard/photographer/events/new`}
    />
  );
}

interface NoSalesEmptyProps {
  t: { title: string; body: string };
}

export function NoSalesEmpty({ t }: NoSalesEmptyProps) {
  return (
    <EmptyState
      compact
      icon={<ShoppingBag className="h-6 w-6 text-muted-foreground" aria-hidden />}
      title={t.title}
      body={t.body}
    />
  );
}

interface NoEventsEmptyProps {
  lang: string;
  t: { title: string; body: string; ctaLabel: string };
}

export function NoEventsEmpty({ lang, t }: NoEventsEmptyProps) {
  return (
    <EmptyState
      icon={<Calendar className="h-6 w-6 text-muted-foreground" aria-hidden />}
      title={t.title}
      body={t.body}
      ctaLabel={t.ctaLabel}
      ctaHref={`/${lang}/dashboard/photographer/events/new`}
    />
  );
}

interface NoPhotosEmptyProps {
  lang: string;
  t: { title: string; body: string; ctaLabel: string };
}

export function NoPhotosEmpty({ lang, t }: NoPhotosEmptyProps) {
  return (
    <EmptyState
      icon={<ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />}
      title={t.title}
      body={t.body}
      ctaLabel={t.ctaLabel}
      ctaHref={`/${lang}/dashboard/photographer/events`}
    />
  );
}

interface ChartEmptyProps {
  t: { title: string; body: string };
}

export function ChartEmpty({ t }: ChartEmptyProps) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center px-6 text-center">
      <h3 className="text-sm font-semibold">{t.title}</h3>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{t.body}</p>
    </div>
  );
}
