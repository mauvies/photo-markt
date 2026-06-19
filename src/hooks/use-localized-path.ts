'use client';

import { useParams } from 'next/navigation';
import type { Locale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/localized-path';

export function useLocalizedPath() {
  const lang = ((useParams()?.lang as Locale) ?? 'es') as Locale;
  return (path: string) => localizedPath(lang, path);
}
