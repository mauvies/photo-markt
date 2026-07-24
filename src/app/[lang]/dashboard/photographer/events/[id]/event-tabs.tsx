'use client';

import { type ReactNode, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type EventTab, parseEventTab } from './event-tab';

type EventTabsProps = {
  initialTab: EventTab;
  labels: { photos: string; details: string; share: string };
  photos: ReactNode;
  details: ReactNode;
  share: ReactNode;
};

/**
 * Top-level tabs for the photographer's event page (T-178): Photos / Details /
 * Share. The persistent event header lives OUTSIDE this component (in the page)
 * so it stays visible on every tab.
 *
 * The tab state is reflected in the URL (`?tab=`) so it is linkable and survives
 * a refresh. Sales only reads `?tab=` on load; here we also push it on change
 * via the native History API — this updates the address bar without a server
 * round trip (no refetch of the heavy page payload) while still surviving F5,
 * since the server reads `?tab=` on the next request.
 *
 * The top-level tabs use the heavier segmented (`default`) variant so they read
 * as a distinct, higher level than the lighter underline (`line`) inner tabs
 * (`EventModerationTabs`, all/pending) nested inside the Photos tab.
 */
export function EventTabs({ initialTab, labels, photos, details, share }: EventTabsProps) {
  const [tab, setTab] = useState<EventTab>(initialTab);

  const handleChange = (value: string) => {
    const next = parseEventTab(value);
    setTab(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url);
    }
  };

  return (
    <Tabs value={tab} onValueChange={handleChange} className="mt-6">
      <TabsList variant="default">
        <TabsTrigger value="photos">{labels.photos}</TabsTrigger>
        <TabsTrigger value="details">{labels.details}</TabsTrigger>
        <TabsTrigger value="share">{labels.share}</TabsTrigger>
      </TabsList>
      <TabsContent value="photos" className="mt-4">
        {photos}
      </TabsContent>
      <TabsContent value="details" className="mt-4">
        {details}
      </TabsContent>
      <TabsContent value="share" className="mt-4">
        {share}
      </TabsContent>
    </Tabs>
  );
}
