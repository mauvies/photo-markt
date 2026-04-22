'use client';

import { format } from 'date-fns';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Package,
  ShoppingCart,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import type { OrderWithItemCount } from './actions';

function formatCurrency(cents: number, currency = 'usd'): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

function getStatusBadge(status: string, t: (key: keyof OrdersListT) => string) {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="default" className="bg-green-500 hover:bg-green-600">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          {t('completed')}
        </Badge>
      );
    case 'pending':
    case 'processing':
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          {status === 'pending' ? t('pending') : t('processing')}
        </Badge>
      );
    case 'failed':
    case 'canceled':
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          {status === 'failed' ? t('failed') : t('canceled')}
        </Badge>
      );
    case 'refunded':
      return (
        <Badge variant="outline" className="border-orange-500 text-orange-600">
          {t('refunded')}
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

type OrdersListT = Dictionary['ordersList'];

interface OrdersListProps {
  orders: OrderWithItemCount[];
}

export function OrdersList({ orders }: OrdersListProps) {
  const { t } = useTranslations<OrdersListT>();
  const [statusFilter, _setStatusFilter] = useState<string>('all');

  const filteredOrders =
    statusFilter === 'all' ? orders : orders.filter((order) => order.status === statusFilter);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t('orderHistory')}</CardTitle>
          <CardDescription>{t('viewAndManage')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShoppingCart className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">
              {statusFilter === 'all'
                ? t('noOrdersYet')
                : t('noStatusOrders').replace('{status}', statusFilter)}
            </h3>
            <p className="mb-4 text-sm text-muted-foreground max-w-sm">
              {statusFilter === 'all'
                ? t('noOrdersDesc')
                : t('noStatusOrdersDesc').replace('{status}', statusFilter)}
            </p>
            {statusFilter === 'all' && (
              <Link href="/dashboard/talent/events">
                <Button>{t('browseEvents')}</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-col gap-4 rounded-lg border p-4 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-muted-foreground">
                      #{order.id.slice(0, 8)}
                    </span>
                    {getStatusBadge(order.status, t)}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(order.created_at), 'MMM d, yyyy')}
                    </div>
                    {order.completed_at && (
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Completed {format(new Date(order.completed_at), 'MMM d, yyyy')}
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      {order.item_count} {order.item_count === 1 ? t('photo') : t('photos')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-lg font-semibold">
                      {formatCurrency(order.total_amount_cents, order.currency)}
                    </div>
                    {order.status === 'completed' && (
                      <Button variant="ghost" size="sm" className="mt-1 h-8 text-xs" disabled>
                        <Download className="mr-1 h-3 w-3" />
                        {t('receipt')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
