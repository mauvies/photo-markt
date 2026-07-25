import { z } from 'zod';
import { activityValues } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { isValidSessionRange, SESSION_RANGE_ERROR } from '@/lib/format-date';

export const eventSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.'),
    activity: z
      .string()
      .min(1, 'Activity is required.')
      .refine(
        (value): value is (typeof activityValues)[number] =>
          activityValues.includes(value as (typeof activityValues)[number]),
        'Activity is required.',
      ),
    date: z.string().min(1, 'Date is required.'),
    // Optional manual session start time ("HH:mm"), separate from time-sync (T-106).
    session_time: z.string().trim().optional().default(''),
    // Optional manual session end time — mirror of session_time (T-180).
    session_end_time: z.string().trim().optional().default(''),
    city: z.string().trim().optional(),
    // State/province + country, captured alongside the city from Google Places
    // and persisted separately (T-107). Optional — legacy events have '' state.
    state: z.string().trim().optional().default(''),
    country: z.string().trim().optional().default(''),
    is_public: z.boolean().default(true),
    watermark_enabled: z.boolean().default(true),
    is_collaborative: z.boolean().default(false),
    allow_guest_upload: z.boolean().default(true),
    require_upload_approval: z.boolean().default(false),
    price_per_photo: z
      .union([z.string(), z.number(), z.null(), z.undefined()])
      .optional()
      .transform((val) => {
        if (val === null || val === undefined || val === '') return null;
        const strVal = typeof val === 'string' ? val : String(val);
        if (strVal.trim() === '') return null;
        const num = Number.parseFloat(strVal);
        return Number.isNaN(num) || num < 0 ? null : num;
      }),
    // AI matching can be toggled here. `contains_minors` is included for echo
    // purposes only — the server action rejects any change to it.
    ai_matching_enabled: z.boolean().default(false),
    contains_minors: z.boolean().default(false),
    bib_detection_enabled: z.boolean().default(false),
    // Reveal gate (T-177): mutable post-creation. Requires ai_matching_enabled;
    // the server forces it off otherwise and on minors events.
    reveal_gate_enabled: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    // T-180 backstop: block a submit with an invalid session range (the end-time
    // field also validates inline).
    if (!isValidSessionRange(data.session_time, data.session_end_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: SESSION_RANGE_ERROR,
        path: ['session_end_time'],
      });
    }
  });

export type FormValues = z.infer<typeof eventSchema>;

export interface PhotoWithUrl {
  id: string;
  url: string | null;
  original_url: string | null;
}

export interface PendingPhoto {
  id: string;
  url: string;
  original_url: null;
  isPending: true;
}

export type DisplayPhoto = PhotoWithUrl | PendingPhoto;
