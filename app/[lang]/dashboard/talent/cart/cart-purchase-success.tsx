'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { localizedPath } from '@/lib/i18n/localized-path';

export function CartPurchaseSuccess({ lang }: { lang: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['cart-count'] });
    router.replace(localizedPath(lang, '/dashboard/talent/profile?purchased=true'));
  }, [router, queryClient, lang]);

  return null;
}
