'use client';

import { useEffect } from 'react';

/**
 * Applies the active locale to `<html lang>` on the client.
 *
 * The root layout renders a static default `lang` so it stays statically
 * prerenderable (reading the locale from `headers()` there would force every
 * page into dynamic rendering). This corrects the attribute per locale once
 * mounted — e.g. on `/en/*` pages.
 */
export function HtmlLangSync({ lang }: { lang: string }) {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return null;
}
