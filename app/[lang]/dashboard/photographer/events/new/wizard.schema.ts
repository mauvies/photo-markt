'use client';

import { z } from 'zod';
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

export const eventSchema = z.object({
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
  // Per-photo fee (in dollars; converted to cents in the server action) that
  // the organizer charges on top of the platform fee. Only applies when
  // event_type === 'organizer'.
  organizer_fee_per_photo: priceSchema,
});

export type FormValues = z.infer<typeof eventSchema>;
