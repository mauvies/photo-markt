import { z } from 'zod';
import { activityValues } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';

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
  city: z.string().trim().optional(),
  is_public: z.boolean().default(true),
  watermark_enabled: z.boolean().default(true),
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
