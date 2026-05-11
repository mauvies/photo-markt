import {
  Bike,
  Footprints,
  type LucideIcon,
  Medal,
  Mountain,
  MountainSnow,
  Waves,
} from 'lucide-react';
import type { activityValues } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';

type ActivityValue = (typeof activityValues)[number];

const ACTIVITY_ICONS: Record<ActivityValue, LucideIcon> = {
  SURF: Waves,
  MTB: Bike,
  SKATEBOARDING: Medal,
  RUNNING_ROAD: Footprints,
  RUNNING_TRAIL: Footprints,
  CYCLING_ROAD: Bike,
  CYCLING_GRAVEL: Bike,
  BMX: Bike,
  TRIATHLON: Medal,
  OPEN_WATER_SWIMMING: Waves,
  SKI_ALPINE: MountainSnow,
  SNOWBOARD: MountainSnow,
  SKI_CROSS_COUNTRY: MountainSnow,
  CLIMBING_BOULDER: Mountain,
  HIKING: Mountain,
  OTHER: Medal,
};

export function getActivityIcon(activity: string): LucideIcon {
  return ACTIVITY_ICONS[activity as ActivityValue] ?? Medal;
}
