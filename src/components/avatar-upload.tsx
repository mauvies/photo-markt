'use client';

import { Loader2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  type AvatarActionResult,
  type AvatarErrorCode,
  removeAvatarAction,
  updateAvatarAction,
} from '@/app/[lang]/actions/avatar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AVATAR_ACCEPT, MAX_AVATAR_BYTES } from '@/lib/avatar-constants';

export interface AvatarUploadLabels {
  changeButton: string;
  removeButton: string;
  updated: string;
  removed: string;
  errorInvalidType: string;
  errorTooLarge: string;
  errorRateLimit: string;
  errorGeneric: string;
}

interface AvatarUploadProps {
  /** Current avatar URL (Google OAuth URL or an uploaded WebP), or null. */
  currentAvatarUrl: string | null;
  /** Initials shown by the fallback when there's no image. */
  fallbackText: string;
  labels: AvatarUploadLabels;
}

function errorLabel(code: AvatarErrorCode, labels: AvatarUploadLabels): string {
  switch (code) {
    case 'invalid-type':
      return labels.errorInvalidType;
    case 'too-large':
      return labels.errorTooLarge;
    case 'rate-limit':
      return labels.errorRateLimit;
    default:
      return labels.errorGeneric;
  }
}

export function AvatarUpload({ currentAvatarUrl, fallbackText, labels }: AvatarUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  // Optimistic preview: a blob URL while uploading, or the committed server URL.
  const [displayUrl, setDisplayUrl] = useState<string | null>(currentAvatarUrl);

  function pickFile() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again re-fires onChange.
    e.target.value = '';
    if (!file) return;

    // Client-side pre-checks for instant feedback. The Server Action re-validates
    // via magic bytes — this never replaces the server gate. Only reject a
    // NON-EMPTY, non-image MIME: browsers often report `''` for HEIC/HEIF, and
    // those are accepted server-side, so an empty type must fall through.
    if (file.type && !file.type.startsWith('image/')) {
      toast.error(labels.errorInvalidType);
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(labels.errorTooLarge);
      return;
    }

    const previousUrl = displayUrl;
    const objectUrl = URL.createObjectURL(file);
    setDisplayUrl(objectUrl);

    const formData = new FormData();
    formData.append('avatar', file);

    startTransition(async () => {
      let result: AvatarActionResult;
      try {
        result = await updateAvatarAction(formData);
      } catch {
        result = { ok: false, error: 'generic' };
      }
      URL.revokeObjectURL(objectUrl);
      if (result.ok) {
        setDisplayUrl(result.avatarUrl);
        toast.success(labels.updated);
        router.refresh();
      } else {
        setDisplayUrl(previousUrl); // rollback
        toast.error(errorLabel(result.error, labels));
      }
    });
  }

  function onRemove() {
    const previousUrl = displayUrl;
    setDisplayUrl(null); // optimistic
    startTransition(async () => {
      let result: AvatarActionResult;
      try {
        result = await removeAvatarAction();
      } catch {
        result = { ok: false, error: 'generic' };
      }
      if (result.ok) {
        toast.success(labels.removed);
        router.refresh();
      } else {
        setDisplayUrl(previousUrl); // rollback
        toast.error(errorLabel(result.error, labels));
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar className="size-20">
          {displayUrl ? <AvatarImage src={displayUrl} alt="" /> : null}
          <AvatarFallback className="text-xl">{fallbackText}</AvatarFallback>
        </Avatar>
        {isPending ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
            <Loader2Icon aria-hidden className="size-6 animate-spin text-foreground" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          className="hidden"
          onChange={onFileChange}
          disabled={isPending}
        />
        <Button type="button" variant="outline" size="sm" onClick={pickFile} disabled={isPending}>
          {labels.changeButton}
        </Button>
        {displayUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={isPending}
            className="text-muted-foreground"
          >
            {labels.removeButton}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
