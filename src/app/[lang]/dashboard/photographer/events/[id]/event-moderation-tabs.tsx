'use client';

import { type ComponentProps, useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EventPhotoAlbum } from './event-photo-album';
import { PendingPhotosTab } from './pending-photos-tab';

type ModerationTab = 'all' | 'pending';

type EventModerationTabsProps = {
  albumProps: Omit<
    ComponentProps<typeof EventPhotoAlbum>,
    'toolbarLeading' | 'onDisplayedCountChange'
  >;
  pendingProps: Omit<ComponentProps<typeof PendingPhotosTab>, 'toolbarLeading'>;
  /** Approved-tab label; the approved count is appended, e.g. "All photos (12)". */
  approvedLabel: string;
  /** Pending-tab label template with `{n}`, e.g. "Pending ({n})". */
  pendingLabelTemplate: string;
  approvedCount: number;
  pendingCount: number;
};

/**
 * Photographer moderation view (T-113): the Approved/Pending switcher lives in
 * the gallery toolbar's left slot — the same row as the "Select" button —
 * instead of a separate row above the panel. The switcher is passed as
 * `toolbarLeading` into whichever panel is active, so it renders inside that
 * panel's `PhotoSelectionToolbar`. The tab labels carry the counts, replacing
 * the standalone photo count (T-104) for moderation events.
 */
export function EventModerationTabs({
  albumProps,
  pendingProps,
  approvedLabel,
  pendingLabelTemplate,
  approvedCount,
  pendingCount,
}: EventModerationTabsProps) {
  const [tab, setTab] = useState<ModerationTab>('all');
  // The Approved-tab count must track the grid's optimistic deletes (T-146).
  // The album owns that state, so it drives this via `onDisplayedCountChange`;
  // we seed from the server prop and re-sync if it changes (e.g. new upload).
  const [approvedDisplay, setApprovedDisplay] = useState(approvedCount);
  useEffect(() => {
    setApprovedDisplay(approvedCount);
  }, [approvedCount]);

  const switcher = (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ModerationTab)}>
      <TabsList>
        <TabsTrigger value="all">{`${approvedLabel} (${approvedDisplay})`}</TabsTrigger>
        <TabsTrigger value="pending">
          {pendingLabelTemplate.replace('{n}', String(pendingCount))}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  return tab === 'all' ? (
    <EventPhotoAlbum
      {...albumProps}
      toolbarLeading={switcher}
      onDisplayedCountChange={setApprovedDisplay}
    />
  ) : (
    <PendingPhotosTab {...pendingProps} toolbarLeading={switcher} />
  );
}
