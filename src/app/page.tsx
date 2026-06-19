import { redirect } from 'next/navigation';

// Non-localized root. In practice `proxy.ts` redirects `/` to a locale (and
// forwards any OAuth `?code=` to /auth/callback) before this ever renders —
// this is just a static fallback.
export default function RootPage() {
  redirect('/es');
}
