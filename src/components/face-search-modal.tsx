'use client';

import { Camera, ChevronDown, ChevronUp, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchFacesInEvent } from '@/app/[lang]/events/[shareCode]/actions';
import {
  isFaceSearchRateLimitError,
  type SearchFacesInEventResult,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface FaceSearchModalLabels {
  title: string;
  description: string;
  takePhotoButton: string;
  choosePhotoButton: string;
  uploadHint: string;
  /**
   * Combined consent line — replaces the prior two GDPR checkboxes. By
   * submitting the form the user implicitly confirms both age and consent
   * to processing. Detailed disclosure lives behind the "More details"
   * disclosure below, inline (no redirect).
   */
  consentLine: string;
  detailsShow: string;
  detailsHide: string;
  /** Three short bullets explaining how the selfie is processed. */
  detailsBullet1: string;
  detailsBullet2: string;
  detailsBullet3: string;
  /** In-modal camera UI strings. */
  cameraCaptureButton: string;
  cameraRetakeButton: string;
  cameraDismissButton: string;
  /** Generic fallback / unsupported / unknown error. */
  cameraError: string;
  /** Browser-reported permission denial — the user has to flip a setting. */
  cameraErrorPermission: string;
  /** No camera device available on this machine. */
  cameraErrorNoDevice: string;
  /** Page is on plain HTTP (outside localhost) — `getUserMedia` is blocked. */
  cameraErrorInsecure: string;
  submitButton: string;
  searching: string;
  errorRateLimit: string;
  errorInvalidSelfie: string;
  errorCollectionMissing: string;
  errorGeneric: string;
  cancelButton: string;
  removeSelfie: string;
}

interface FaceSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareCode: string;
  labels: FaceSearchModalLabels;
  /**
   * Called with the SA's result on a successful search. The parent decides
   * what to do with it (lift matches into the gallery, close modal, etc.).
   * For `reason: 'invalid-selfie'` outcomes the modal stays open and shows
   * the inline error itself — the parent is NOT called.
   */
  onResult: (result: SearchFacesInEventResult) => void;
}

const MAX_SELFIE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = 'image/jpeg,image/png,image/heic,image/heif';

/**
 * Single-step face-search modal.
 *
 * Selfie input has two paths:
 *   - **Take photo** → opens a live in-modal camera via `getUserMedia`.
 *     Works on desktop and mobile equivalently (the prior `<input capture>`
 *     approach degraded on desktop to the regular file picker, which the
 *     user reported as a bug). On capture, a frame is drawn to a canvas
 *     and converted to a JPEG `File` that becomes the selfie. Camera
 *     tracks are stopped immediately after capture / on cancel / on
 *     unmount.
 *   - **Upload photo** → standard file picker (`<input type="file">`).
 *
 * Bytes never live in component state beyond the preview blob URL, which
 * is revoked on file replacement / unmount.
 *
 * Consent is implicit at submit: a single sentence below the selfie picker
 * states the age + processing commitment, with a "More details" disclosure
 * that expands inline (no navigation away from the modal).
 */
export function FaceSearchModal({
  open,
  onOpenChange,
  shareCode,
  labels,
  onResult,
}: FaceSearchModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** 'idle' = picker visible; 'live' = `<video>` stream visible; 'denied' = permission/error fallback. */
  const [cameraMode, setCameraMode] = useState<'idle' | 'live' | 'denied'>('idle');

  /**
   * Stop every track on the active stream and drop the reference. Safe to
   * call multiple times — idempotent. Centralized so cleanup on close /
   * unmount / capture / retake all share the same code path.
   */
  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Reset transient state every time the modal is opened so a re-open
  // starts with a clean slate. Tracks are also stopped on close.
  useEffect(() => {
    if (!open) {
      stopCamera();
      setCameraMode('idle');
      return;
    }
    setFile(null);
    setError(null);
    setIsSubmitting(false);
    setDetailsOpen(false);
    setCameraMode('idle');
  }, [open, stopCamera]);

  // Belt-and-suspenders: stop tracks on unmount even if the parent forgot
  // to flip `open` to false (e.g., full-page navigation during search).
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Manage the preview URL lifecycle. Revoke on file replacement OR unmount
  // so we don't keep blob:// URLs alive after they're no longer rendered.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPickFile = useCallback(
    (incoming: File | undefined) => {
      setError(null);
      if (!incoming) {
        setFile(null);
        return;
      }
      if (incoming.size > MAX_SELFIE_BYTES) {
        // Client-side guard — server re-validates via validatePhotoUpload.
        setFile(null);
        setError(labels.errorGeneric);
        return;
      }
      setFile(incoming);
    },
    [labels.errorGeneric],
  );

  /**
   * Request the front-facing camera. Surfaces a specific localized error
   * per failure mode so the user can act on it instead of seeing the same
   * generic copy for every cause.
   *
   * Stream-attach is handled by a separate effect that runs once
   * `cameraMode` flips to `'live'` and the `<video>` element is in the
   * DOM. Previously we used `queueMicrotask` which works in practice but
   * the effect-based approach is the idiomatic React pattern and is
   * easier to reason about.
   */
  const startCamera = useCallback(async () => {
    setError(null);

    // Secure-context check. `getUserMedia` requires HTTPS or a localhost
    // origin — over plain HTTP on a LAN IP, `navigator.mediaDevices` is
    // simply not exposed. Surface the specific cause so the developer
    // doesn't waste time toggling permissions.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setCameraMode('denied');
      setError(labels.cameraErrorInsecure);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraMode('denied');
      setError(labels.cameraError);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraMode('live');
    } catch (err) {
      setCameraMode('denied');
      // Log the error NAME ONLY — never the message body or any
      // arguments, since some browsers include device metadata that
      // could be PII. The name is a well-known WebRTC string ("NotAllowedError"
      // etc.) so it's safe to surface for debugging.
      const name = err instanceof Error ? err.name : '';
      if (typeof console !== 'undefined') {
        console.warn('[face-search] camera open failed:', name || 'unknown');
      }
      // WebRTC error names per spec
      // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions
      if (
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError' ||
        name === 'SecurityError'
      ) {
        setError(labels.cameraErrorPermission);
      } else if (
        name === 'NotFoundError' ||
        name === 'DevicesNotFoundError' ||
        name === 'OverconstrainedError'
      ) {
        setError(labels.cameraErrorNoDevice);
      } else {
        setError(labels.cameraError);
      }
    }
  }, [
    labels.cameraError,
    labels.cameraErrorInsecure,
    labels.cameraErrorNoDevice,
    labels.cameraErrorPermission,
  ]);

  /**
   * Effect-based stream attach: once `cameraMode === 'live'` AND the
   * `<video>` element has rendered, wire up the active MediaStream. Runs
   * after each commit so the ref is guaranteed to point at a real element.
   */
  useEffect(() => {
    if (cameraMode !== 'live') return;
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video) return;
    video.srcObject = stream;
    // `play()` may reject under autoplay policies. Mute + playsInline on
    // the <video> element should satisfy iOS Safari; we swallow the
    // rejection because the first frame paints anyway.
    video.play().catch(() => {});
  }, [cameraMode]);

  /**
   * Snapshot the current video frame to a hidden canvas, convert to a
   * JPEG blob, wrap as a `File`, and feed through the same `onPickFile`
   * path the upload button uses. After capture the camera is closed —
   * the preview branch takes over.
   */
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    // Use the video's *intrinsic* dimensions so the captured image
    // matches what the camera is actually emitting (not the on-screen
    // size from CSS).
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const captured = new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onPickFile(captured);
        stopCamera();
        setCameraMode('idle');
      },
      'image/jpeg',
      0.9,
    );
  }, [onPickFile, stopCamera]);

  const dismissCamera = useCallback(() => {
    stopCamera();
    setCameraMode('idle');
    setError(null);
  }, [stopCamera]);

  const canSubmit = useMemo(() => file !== null && !isSubmitting, [file, isSubmitting]);

  const submit = async () => {
    if (!canSubmit || !file) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('selfie', file);
      const result = await searchFacesInEvent(shareCode, formData);

      if (result.reason === 'invalid-selfie') {
        // Stay open; modal handles its own error copy. Parent never sees this.
        setError(labels.errorInvalidSelfie);
        return;
      }
      if (result.reason === 'collection-missing') {
        // Surface to parent so it can hide the banner; close modal.
        onResult(result);
        onOpenChange(false);
        return;
      }
      onResult(result);
      onOpenChange(false);
    } catch (err) {
      if (isFaceSearchRateLimitError(err)) {
        setError(labels.errorRateLimit);
      } else {
        // Generic copy — never echo the SDK error message to the UI; that
        // path is where selfie bytes can leak via SDK error metadata.
        setError(labels.errorGeneric);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block close while a search is in flight — we don't want the
        // user navigating away while their selfie is on the wire.
        if (!next && isSubmitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Hidden file picker — driven by the "Upload photo" CTA. */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME}
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0])}
            disabled={isSubmitting}
          />
          {/* Hidden capture canvas — invisible scratch surface for the
              video → JPEG conversion. `tabIndex={-1}` removes it from the
              focus order so aria-hidden doesn't trap any focusable element. */}
          <canvas ref={canvasRef} className="hidden" tabIndex={-1} />

          {cameraMode === 'live' ? (
            // Live camera view
            <div className="flex flex-col gap-3">
              <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-input bg-black">
                {/* Mirror horizontally so users see themselves the way
                    they'd expect from a phone selfie. */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full -scale-x-100 object-cover"
                  aria-label={labels.takePhotoButton}
                >
                  <track kind="captions" />
                </video>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={dismissCamera}
                  disabled={isSubmitting}
                >
                  {labels.cameraDismissButton}
                </Button>
                <Button type="button" size="sm" onClick={captureFrame} disabled={isSubmitting}>
                  <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {labels.cameraCaptureButton}
                </Button>
              </div>
            </div>
          ) : previewUrl ? (
            // Selected/captured photo preview
            <div className="flex items-center gap-3">
              <div className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-lg border border-input">
                {/* biome-ignore lint/performance/noImgElement: blob: URLs from
                    URL.createObjectURL can't be served via next/image — the
                    preview is local-only and doesn't benefit from CDN
                    optimization. */}
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onPickFile(undefined)}
                  className="absolute -right-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/80 text-background shadow-sm hover:bg-foreground"
                  aria-label={labels.removeSelfie}
                  disabled={isSubmitting}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <p className="text-xs text-muted-foreground">{labels.uploadHint}</p>
                <button
                  type="button"
                  onClick={() => {
                    onPickFile(undefined);
                    void startCamera();
                  }}
                  className="self-start text-xs font-medium text-primary hover:underline"
                  disabled={isSubmitting}
                >
                  {labels.cameraRetakeButton}
                </button>
              </div>
            </div>
          ) : (
            // Empty state — two CTAs
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  disabled={isSubmitting}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input bg-muted/20 px-3 py-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 hover:text-primary disabled:opacity-50"
                >
                  <Camera className="h-6 w-6" aria-hidden="true" />
                  <span className="font-medium">{labels.takePhotoButton}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input bg-muted/20 px-3 py-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 hover:text-primary disabled:opacity-50"
                >
                  <ImageIcon className="h-6 w-6" aria-hidden="true" />
                  <span className="font-medium">{labels.choosePhotoButton}</span>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{labels.uploadHint}</p>
            </div>
          )}

          {/* Single consent line — replaces the prior two checkboxes. */}
          <p className="text-xs leading-relaxed text-muted-foreground">{labels.consentLine}</p>

          {/* Inline "More details" disclosure. Stays within the modal so the
              user never loses their upload context. */}
          <div className="rounded-md border border-input bg-muted/20">
            <button
              type="button"
              onClick={() => setDetailsOpen((prev) => !prev)}
              aria-expanded={detailsOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {detailsOpen ? labels.detailsHide : labels.detailsShow}
              {detailsOpen ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
            {detailsOpen ? (
              <ul className="space-y-1.5 border-t border-input px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <li>• {labels.detailsBullet1}</li>
                <li>• {labels.detailsBullet2}</li>
                <li>• {labels.detailsBullet3}</li>
              </ul>
            ) : null}
          </div>

          {/* Inline error */}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {labels.cancelButton}
            </Button>
            <Button type="button" size="sm" onClick={submit} disabled={!canSubmit}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {labels.searching}
                </>
              ) : (
                labels.submitButton
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
