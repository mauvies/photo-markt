'use client';

import { X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dropzone } from '@/components/uploader/Dropzone';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useUploadProgress } from './upload-progress-provider';

const GUEST_NAME_KEY = 'photo-markt_guest_name';
const GUEST_EMAIL_KEY = 'photo-markt_guest_email';

type CollaborativeT = Dictionary['collaborativeEvent'];

type ContributeSectionProps = {
  eventId: string;
  shareCode: string;
  isAuthenticated: boolean;
  requireApproval: boolean;
  t: CollaborativeT;
  /** When rendered inside a Dialog, skip the outer card frame and heading. */
  embedded?: boolean;
  /** Called after a successful upload — used by the modal wrapper to close. */
  onSuccess?: () => void;
};

type FilePreview = { id: string; url: string; file: File };

export function ContributeSection({
  eventId,
  shareCode,
  isAuthenticated,
  requireApproval,
  t,
  embedded = false,
  onSuccess,
}: ContributeSectionProps) {
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nameInputId = useId();
  const emailInputId = useId();
  const { triggerUpload, isUploading } = useUploadProgress();
  // Disable inputs while a previous upload is still in flight to prevent
  // double-submit. The modal closes on submit so this guard is mostly for
  // re-opens that happen before the upload finishes.
  const isPending = isUploading;

  useEffect(() => {
    if (isAuthenticated) return;
    try {
      const storedName = localStorage.getItem(GUEST_NAME_KEY);
      if (storedName) setGuestName(storedName);
      const storedEmail = localStorage.getItem(GUEST_EMAIL_KEY);
      if (storedEmail) setGuestEmail(storedEmail);
    } catch {
      // ignore
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const next = files.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      url: URL.createObjectURL(file),
      file,
    }));
    setPreviews(next);
    return () => {
      for (const p of next) URL.revokeObjectURL(p.url);
    };
  }, [files]);

  const handleFiles = (incoming: File[]) => {
    setFiles((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        const exists = next.some(
          (item) =>
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified,
        );
        if (!exists) next.push(file);
      }
      return next;
    });
    setError(null);
  };

  const removeFile = (target: File) => {
    setFiles((prev) => prev.filter((file) => file !== target));
  };

  const handleSubmit = () => {
    setError(null);

    if (files.length === 0) {
      setError(t.errorNoFiles);
      return;
    }
    if (!isAuthenticated && guestName.trim().length === 0) {
      setError(t.errorNameRequired);
      return;
    }

    if (!isAuthenticated) {
      try {
        localStorage.setItem(GUEST_NAME_KEY, guestName.trim());
        if (guestEmail.trim()) {
          localStorage.setItem(GUEST_EMAIL_KEY, guestEmail.trim());
        }
      } catch {
        // ignore
      }
    }

    // Fire-and-forget: kick off the upload via the page-level provider so it
    // survives the modal unmounting. Then close the modal immediately so the
    // user can keep browsing while the gallery shows a loading overlay.
    void triggerUpload({
      eventId,
      files,
      isAuthenticated,
      shareCode,
      guestName: !isAuthenticated ? guestName.trim() : null,
      guestEmail: !isAuthenticated && guestEmail.trim() ? guestEmail.trim() : null,
      requireApproval,
    });
    setFiles([]);
    onSuccess?.();
  };

  // Content shared between embedded and standalone modes.
  const inputsAndDropzone = (
    <div
      className={
        // Two-column on md+ when we need to ask for guest name/email
        // (left column = inputs, right column = dropzone). Authenticated
        // users skip the inputs entirely, so the dropzone takes full width.
        isAuthenticated ? 'flex flex-col gap-4' : 'grid gap-4 md:grid-cols-2 md:items-start'
      }
    >
      {!isAuthenticated && (
        <div className="flex flex-col gap-2">
          <div className="grid gap-2">
            <Label htmlFor={nameInputId}>{t.guestNameLabel}</Label>
            <Input
              id={nameInputId}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder={t.guestNamePlaceholder}
              maxLength={60}
              disabled={isPending}
              autoComplete="name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={emailInputId}>{t.guestEmailLabel}</Label>
            <Input
              id={emailInputId}
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder={t.guestEmailPlaceholder}
              maxLength={120}
              disabled={isPending}
              autoComplete="email"
            />
            <p className="text-xs text-muted-foreground">{t.guestEmailHelper}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Dropzone accept="image/*" onSelect={handleFiles} className="rounded-lg" />
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4">
            {previews.map((preview) => (
              <div
                key={preview.id}
                className="group relative aspect-square overflow-visible rounded-lg"
              >
                <div className="absolute inset-0 overflow-hidden rounded-lg border border-dashed border-primary/50 bg-muted">
                  <Image
                    src={preview.url}
                    alt={preview.file.name}
                    fill
                    sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 14vw"
                    className="object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(preview.file)}
                  className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/80 text-gray-300 shadow-sm transition-opacity hover:bg-foreground"
                  aria-label={t.removePhoto}
                  disabled={isPending}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const submitButton = (
    <Button type="button" onClick={handleSubmit} disabled={isPending || files.length === 0}>
      {isPending
        ? t.uploadingButton
        : files.length > 0
          ? t.submitButton.replace('{n}', String(files.length))
          : t.submitButtonEmpty}
    </Button>
  );

  // In embedded (dialog) mode: flex column with a scrollable body and a
  // pinned footer so the submit button is always visible regardless of how
  // many photo previews are queued.
  if (embedded) {
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {inputsAndDropzone}
        </div>
        <div className="flex flex-col gap-2 pt-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">{submitButton}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-input bg-card p-4 md:p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t.uploadHeading}</h2>
        <p className="text-sm text-muted-foreground">
          {requireApproval ? t.uploadDescPending : t.uploadDesc}
        </p>
      </div>
      {inputsAndDropzone}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">{submitButton}</div>
    </section>
  );
}
