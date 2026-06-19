import { headers } from 'next/headers';
import { defaultLocale, type Locale } from './config';

export async function getLangFromHeaders(): Promise<Locale> {
  return ((await headers()).get('x-lang') ?? defaultLocale) as Locale;
}
