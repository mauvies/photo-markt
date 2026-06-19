import { format } from 'date-fns';
import { ArrowRight, ImageOff } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { RecentSale } from '../actions';
import { NoSalesEmpty } from './empty-states';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

interface RecentSalesListProps {
  sales: RecentSale[];
  lang: string;
  /** Cap to a smaller count on mobile to keep the section dense. */
  mobileLimit?: number;
  t: {
    title: string;
    viewAll: string;
    unnamedEvent: string;
    emptyTitle: string;
    emptyBody: string;
  };
}

export function RecentSalesList({ sales, lang, mobileLimit = 3, t }: RecentSalesListProps) {
  return (
    <section className="flex h-full flex-col rounded-xl border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-5 sm:py-4">
        <h2 className="text-base font-semibold sm:text-lg">{t.title}</h2>
      </header>

      {sales.length === 0 ? (
        <div className="flex-1 p-4">
          <NoSalesEmpty t={{ title: t.emptyTitle, body: t.emptyBody }} />
        </div>
      ) : (
        <>
          <ul className="flex-1 divide-y">
            {sales.map((sale, index) => (
              <li key={sale.id} className={index >= mobileLimit ? 'hidden lg:block' : undefined}>
                <Link
                  href={`/${lang}/dashboard/photographer/sales`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 sm:px-5"
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                    {sale.photoUrl ? (
                      <Image
                        src={sale.photoUrl}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageOff className="h-5 w-5" aria-hidden />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {sale.eventName || t.unnamedEvent}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {format(new Date(sale.createdAt), 'MMM d')}
                      {sale.buyerEmailMasked ? ` · ${sale.buyerEmailMasked}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatCurrency(sale.amountCents)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={`/${lang}/dashboard/photographer/sales`}
            className="flex items-center justify-between border-t px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground sm:px-5"
          >
            <span>{t.viewAll}</span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </>
      )}
    </section>
  );
}
