'use client';

import { type ReactNode, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type FavoritesTab = 'photos' | 'events';

/**
 * Underline-style tabs for the Favorites page (Photos | Events). Both panels
 * are server-rendered and passed in as children; this client wrapper toggles
 * which one is shown. Uses the shared Shadcn `Tabs` line variant so the
 * underline spans only the tabs' content width — matching the Ventas page.
 */
export function FavoritesTabs({
  photosLabel,
  eventsLabel,
  photosTab,
  eventsTab,
}: {
  photosLabel: string;
  eventsLabel: string;
  photosTab: ReactNode;
  eventsTab: ReactNode;
}) {
  const [tab, setTab] = useState<FavoritesTab>('photos');

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as FavoritesTab)} className="mt-4">
      <TabsList>
        <TabsTrigger value="photos">{photosLabel}</TabsTrigger>
        <TabsTrigger value="events">{eventsLabel}</TabsTrigger>
      </TabsList>
      <TabsContent value="photos" className="mt-4">
        {photosTab}
      </TabsContent>
      <TabsContent value="events" className="mt-4">
        {eventsTab}
      </TabsContent>
    </Tabs>
  );
}
