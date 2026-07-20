import { Spinner } from '@/components/ui/spinner';

// Neutral safety-net loading fallback for any async route under `[lang]/*` that
// doesn't ship its own `loading.tsx` (e.g. `photographer/[slug]`, `cart`,
// `checkout`, `onboarding`, `download`). The home's card-grid skeleton lives in
// the `(home)` route group so it no longer leaks here (T-171) — this is a plain
// spinner, never a page-specific shell.
export default function Loading() {
  return <Spinner />;
}
