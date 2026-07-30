'use client';

import { z } from 'zod';
import { isValidSessionRange, SESSION_RANGE_ERROR } from '@/lib/format-date';
import { activityValues } from './activity-options';

export const EVENT_TYPES = ['solo', 'collaborative', 'organizer'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const priceSchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional()
  .transform((val) => {
    if (val === null || val === undefined || val === '') return null;
    const strVal = typeof val === 'string' ? val : String(val);
    if (strVal.trim() === '') return null;
    const num = Number.parseFloat(strVal);
    return Number.isNaN(num) || num < 0 ? null : num;
  });

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
    // Optional manual session start time ("HH:mm"), separate from camera
    // time-sync. Empty when the photographer doesn't set one (T-106).
    session_time: z.string().trim().optional().default(''),
    // Optional manual session end time ("HH:mm") — mirror of session_time (T-180).
    // Empty when unset; when set it requires a start and must be after it (refine
    // below). Both remain optional.
    session_end_time: z.string().trim().optional().default(''),
    country: z.string().trim().optional().default(''),
    state: z.string().trim().optional().default(''),
    city: z.string().trim().min(1, 'Location is required.'),
    event_type: z.enum(EVENT_TYPES).default('solo'),
    is_public: z.boolean().default(true),
    watermark_enabled: z.boolean().default(true),
    // Mirrored from event_type at submit time. Kept on the schema for backward
    // compatibility with code that still reads is_collaborative directly.
    is_collaborative: z.boolean().default(false),
    allow_guest_upload: z.boolean().default(true),
    require_upload_approval: z.boolean().default(false),
    price_per_photo: priceSchema,
    // Volume-pricing ladder (T-203): rungs of {minQuantity, totalPriceCents},
    // ascending. Shape only — the authoritative rules (ordering, monotonic
    // totals, floor, "is it actually a discount") live server-side in
    // `validateBundleSchedule`, so they can't drift between client and server.
    bundle_tiers: z
      .array(
        z.object({
          minQuantity: z.number().int(),
          totalPriceCents: z.number().int(),
        }),
      )
      .nullable()
      .default(null),
    /** "All photos" flat price in cents (T-203) — a ceiling, no threshold. */
    bundle_all_photos_cents: z.number().int().nullable().default(null),
    // Per-photo fee (in dollars; converted to cents in the server action) that
    // the organizer charges on top of the platform fee. Only applies when
    // event_type === 'organizer'.
    organizer_fee_per_photo: priceSchema,
    // AWS Rekognition face matching opt-in. When ON, photos uploaded to this
    // event are indexed so talents can later find their photos via selfie.
    // Forced to false when `contains_minors` is true (compliance).
    ai_matching_enabled: z.boolean().default(false),
    // Compliance flag for events with photos of children. Logically immutable
    // after event creation — enforcement of immutability lives in the edit
    // server action. When true, AI matching cannot be enabled.
    contains_minors: z.boolean().default(false),
    // Bib number detection opt-in. Disabled for events with minors (parity
    // with ai_matching_enabled). Photos are scanned via Rekognition DetectText.
    bib_detection_enabled: z.boolean().default(false),
    // Reveal gate (T-177): hide photos from browsing; reveal only via face
    // search. Requires ai_matching_enabled; unavailable on minors events.
    reveal_gate_enabled: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    // T-180 backstop: block a final submit with an invalid session range (the
    // end-time field also validates inline for immediate feedback).
    if (!isValidSessionRange(data.session_time, data.session_end_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: SESSION_RANGE_ERROR,
        path: ['session_end_time'],
      });
    }
  });

export type FormValues = z.infer<typeof eventSchema>;
