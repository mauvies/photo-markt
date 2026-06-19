'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef } from 'react';

/**
 * Provides a stable QueryClient per browser session.
 * Using useRef (not useState) so the client is created once and never
 * triggers a re-render on its own.
 *
 * Cache settings:
 *  - staleTime 60s  → data is considered fresh for 1 minute; navigating back
 *                     shows cached results instantly with no background refetch.
 *  - gcTime   5min  → keep unused queries in memory for 5 minutes so that
 *                     a rapid back-navigation always hits the in-memory cache.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<QueryClient | null>(null);
  if (!clientRef.current) clientRef.current = makeQueryClient();

  return <QueryClientProvider client={clientRef.current}>{children}</QueryClientProvider>;
}
