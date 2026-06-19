'use client';

import { Sparkles, UserCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useLoginHref, useSignupHref } from '@/hooks/use-login-href';

export function EventInfoCards() {
  const buildLoginHref = useLoginHref();
  const buildSignupHref = useSignupHref();
  return (
    <div className="my-6 grid gap-3 sm:grid-cols-2">
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <UserCircle2 className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Save photos forever</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Create a free account to keep purchased photos in your library permanently.
          </p>
          <div className="mt-2 flex gap-2">
            <Link href={buildLoginHref()}>
              <Button variant="outline" size="sm" className="h-7 px-3 text-xs">
                Log in
              </Button>
            </Link>
            <Link href={buildSignupHref()}>
              <Button size="sm" className="h-7 px-3 text-xs">
                Sign up free
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">AI face matching</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Upload a selfie and let AI instantly find photos of you across thousands of event shots.
          </p>
        </div>
      </div>
    </div>
  );
}
