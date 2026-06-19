import { redirect } from 'next/navigation';
import { localizedPath } from './localized-path';

export function localizedRedirect(locale: string, path: string): never {
  return redirect(localizedPath(locale, path));
}
