'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocalizedPath } from '@/hooks/use-localized-path';

export default function PrivateEventPage() {
  const [code, setCode] = useState('');
  const router = useRouter();
  const lp = useLocalizedPath();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push(lp(`/events/${trimmed}`));
  };

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Private event access</h1>
          <p className="text-sm text-muted-foreground">
            Enter the code shared by the photographer to view the event.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter access code"
            autoFocus
          />
          <Button type="submit" className="w-full" disabled={!code.trim()}>
            Access event
          </Button>
        </form>
      </div>
    </div>
  );
}
