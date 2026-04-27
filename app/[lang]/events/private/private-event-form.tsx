'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocalizedPath } from '@/hooks/use-localized-path';

export function PrivateEventForm({ labels }: { labels: { placeholder: string; button: string } }) {
  const [code, setCode] = useState('');
  const router = useRouter();
  const lp = useLocalizedPath();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    router.push(lp(`/events/${trimmed}`));
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={labels.placeholder}
        className="text-center tracking-widest uppercase"
        autoComplete="off"
        autoFocus
      />
      <Button type="submit" disabled={!code.trim()} className="w-full">
        {labels.button}
      </Button>
    </form>
  );
}
