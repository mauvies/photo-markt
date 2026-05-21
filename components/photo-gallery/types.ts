import type { LucideIcon } from 'lucide-react';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';

export type { PhotoAlbumItem };

/** A titled group of photos — used for the AI face-search confidence buckets. */
export interface PhotoGallerySection {
  key: string;
  title?: string;
  subtitle?: string;
  items: PhotoAlbumItem[];
}

/** One bulk action in the selection bars (desktop toolbar + mobile bottom bar). */
export interface PhotoGalleryBulkAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onRun: (selectedIds: string[]) => void;
  isPending?: boolean;
  /** When false the action is omitted from the bars. Defaults to true. */
  visible?: boolean;
}

/** Localized copy for the selection toolbar / bars. */
export interface PhotoGallerySelectionLabels {
  select: string;
  clear: string;
  countNone: string;
  countOne: string;
  /** "{n}" placeholder substituted with the selected count. */
  countMany: string;
  exitSelection: string;
}
