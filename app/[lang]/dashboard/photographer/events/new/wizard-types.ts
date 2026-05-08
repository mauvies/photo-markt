'use client';

import { useForm } from '@tanstack/react-form';
import type { FormValues } from './wizard.schema';

const EMPTY_DEFAULTS: FormValues = {
  name: '',
  activity: 'OTHER',
  date: '',
  country: '',
  state: '',
  city: '',
  event_type: 'solo',
  is_public: true,
  watermark_enabled: true,
  is_collaborative: false,
  allow_guest_upload: true,
  require_upload_approval: false,
  price_per_photo: null,
  organizer_fee_per_photo: null,
};

// Factory hook so the inferred form type can be exported via ReturnType.
// `useForm` has too many generics to reference directly with `ReturnType<typeof useForm<...>>`.
export function useEventForm() {
  return useForm({
    defaultValues: EMPTY_DEFAULTS,
    onSubmit: () => {
      // Submission is triggered explicitly from the wizard shell, not via
      // a form-element submit event. This keeps accidental submits inert.
    },
  });
}

export type EventForm = ReturnType<typeof useEventForm>;

export type FilePreview = { id: string; url: string; file: File };
