export function localizedPath(locale: string, path: string): string {
  const [pathname, query] = path.split('?');
  const base = pathname === '/' ? '' : pathname;
  return query ? `/${locale}${base}?${query}` : `/${locale}${base}`;
}
