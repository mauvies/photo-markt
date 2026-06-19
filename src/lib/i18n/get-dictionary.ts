import type enDict from '@/dictionaries/en.json';
import type { Locale } from './config';

export type Dictionary = typeof enDict;

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  return import(`@/dictionaries/${locale}.json`).then((m) => m.default);
}

export async function getDictionarySection<K extends keyof Dictionary>(
  lang: Locale,
  section: K,
): Promise<Dictionary[K]> {
  const dict = await getDictionary(lang);
  return dict[section];
}
