'use client';

import { useEffect, useState } from 'react';
import { checkUsernameAvailability } from '@/app/[lang]/actions/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { isValidUsername, normalizeUsername } from '@/lib/username';

type Props = {
  saveRole: (formData: FormData) => Promise<void>;
  dict: Dictionary['onboarding'];
  errorMessage?: string;
  /** Valid, available username to pre-fill the field with. Fully editable. */
  suggestedUsername?: string;
};

type Availability = 'idle' | 'checking' | 'available' | 'unavailable';

export default function OnboardingRoleForm({
  saveRole,
  dict,
  errorMessage,
  suggestedUsername,
}: Props) {
  const [selectedRole, setSelectedRole] = useState<'photographer' | 'talent' | null>(null);
  const [username, setUsername] = useState(suggestedUsername ?? '');
  const [availability, setAvailability] = useState<Availability>('idle');

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(normalizeUsername(e.target.value));
  };

  const isUsernameValid = isValidUsername(username);

  // Debounced availability check (~400ms) against the server action. The
  // server applies the same normalization + format rules and treats the user's
  // own username as available.
  useEffect(() => {
    if (!isUsernameValid) {
      setAvailability('idle');
      return;
    }

    setAvailability('checking');
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailability(username);
        if (cancelled) return;
        setAvailability(result.available ? 'available' : 'unavailable');
      } catch {
        // Availability is advisory; the server action re-validates on submit.
        if (!cancelled) setAvailability('idle');
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [username, isUsernameValid]);

  return (
    <form action={saveRole} className="grid gap-6">
      <input type="hidden" name="role" value={selectedRole ?? ''} />
      <input type="hidden" name="username" value={username} />

      {errorMessage && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {errorMessage}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          type="button"
          onClick={() => setSelectedRole('photographer')}
          className={`h-32 rounded-xl border-2 p-6 text-left transition-colors ${
            selectedRole === 'photographer'
              ? 'border-primary bg-primary/5'
              : 'border-muted hover:border-primary/50'
          }`}
        >
          <div className="text-xl font-semibold">{dict.photographer}</div>
          <div className="mt-2 text-sm text-muted-foreground">{dict.photographerDesc}</div>
        </button>

        <button
          type="button"
          onClick={() => setSelectedRole('talent')}
          className={`h-32 rounded-xl border-2 p-6 text-left transition-colors ${
            selectedRole === 'talent'
              ? 'border-primary bg-primary/5'
              : 'border-muted hover:border-primary/50'
          }`}
        >
          <div className="text-xl font-semibold">{dict.talent}</div>
          <div className="mt-2 text-sm text-muted-foreground">{dict.talentDesc}</div>
        </button>
      </div>

      {selectedRole && (
        <div className="space-y-2">
          <Label htmlFor="username">{dict.usernameLabel}</Label>
          <Input
            id="username"
            name="username"
            type="text"
            value={username}
            onChange={handleUsernameChange}
            placeholder={dict.usernamePlaceholder}
            minLength={3}
            maxLength={30}
            pattern="[a-z0-9_-]+"
            required
            className="rounded-full"
          />
          <p className="text-xs text-muted-foreground">{dict.usernameHelp}</p>
          {username && !isUsernameValid && (
            <p className="text-xs text-destructive">{dict.usernameTooShort}</p>
          )}
          {isUsernameValid && availability === 'checking' && (
            <p className="text-xs text-muted-foreground">{dict.checking}</p>
          )}
          {isUsernameValid && availability === 'available' && (
            <p className="text-xs text-emerald-600">{dict.available}</p>
          )}
          {isUsernameValid && availability === 'unavailable' && (
            <p className="text-xs text-destructive">{dict.unavailable}</p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!selectedRole || !isUsernameValid || availability === 'unavailable'}
          className="px-8"
          size="lg"
        >
          {dict.continue}
        </Button>
      </div>
    </form>
  );
}
