'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { safeNext } from '@/lib/auth/safe-next';

export function CloseButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lp = useLocalizedPath();

  const handleClick = () => {
    if (pathname?.startsWith('/auth/reset-password')) {
      router.push(lp('/login'));
      return;
    }

    // On login / signup the `?next=` target may be an auth-gated page — a
    // forced logout, or an unauthenticated visit to a protected route, lands
    // the user here with `?next=` pointing at a page they can't access.
    // Returning there bounces straight back to login (an infinite loop), so
    // the cancel ("X") destination must not require auth: always go home.
    if (pathname?.endsWith('/login') || pathname?.endsWith('/signup')) {
      router.push(lp('/'));
      return;
    }

    // Other pages: return to the page the user came from. `useLoginHref` /
    // `useSignupHref` capture it as a (locale-stripped) `?next=` param;
    // `safeNext` rejects open-redirect targets. Pushing this known
    // destination is deterministic — unlike `router.back()`, which depends on
    // an unpredictable history stack and can re-fetch an unexpected route.
    const next = safeNext(searchParams.get('next'));
    router.push(lp(next ?? '/'));
  };

  return (
    <button
      type="button"
      aria-label="Close"
      onClick={handleClick}
      className={`inline-flex h-9 w-9 items-center justify-center text-foreground/70 hover:text-foreground/60 transition-colors ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-7 w-7"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
