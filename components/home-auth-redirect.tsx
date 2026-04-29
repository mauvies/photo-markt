'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getHomeRedirectPath } from '@/app/[lang]/actions/home-redirect';
import { localizedPath } from '@/lib/i18n/localized-path';

export function HomeAuthRedirect({ lang }: { lang: string }) {
  const router = useRouter();

  useEffect(() => {
    void getHomeRedirectPath().then((path) => {
      if (path) router.replace(localizedPath(lang, path));
    });
  }, [router, lang]);

  return null;
}
