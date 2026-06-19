'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-muted-foreground">An unexpected error occurred. Please try again.</p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
