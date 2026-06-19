'use client';

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const TranslationsContext = createContext<Record<string, unknown> | null>(null);

export function TranslationsProvider<T extends Record<string, unknown>>({
  translations,
  children,
}: {
  translations: T;
  children: ReactNode;
}) {
  return (
    <TranslationsContext.Provider value={translations as Record<string, unknown>}>
      {children}
    </TranslationsContext.Provider>
  );
}

export function useTranslations<T extends Record<string, unknown>>() {
  const ctx = useContext(TranslationsContext);
  if (ctx === null) {
    throw new Error(
      'useTranslations must be used within a TranslationsProvider. ' +
        'Wrap this component (or its parent Server Component) with <TranslationsProvider translations={...}>.',
    );
  }
  function t<K extends keyof T & string>(key: K): T[K] {
    return (ctx as T)[key];
  }
  return { t };
}
