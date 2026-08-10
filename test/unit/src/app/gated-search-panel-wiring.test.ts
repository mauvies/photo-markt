import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-230 — the reveal-gated pre-search screen, pinned on BOTH viewing surfaces.
 *
 * A gated event (T-177) has no browsable gallery: its photos are revealed only
 * to a visitor who proves a face-search match. So before the search, that screen
 * IS the product — and it used to render one muted line inside the gallery slot
 * while the actual search button lived in a separate banner above it, which is
 * why the copy had to say "take a selfie *above*". The page read as empty.
 *
 * `<GatedSearchPanel>` now owns the whole slot for all three pre-search states
 * (searchable / processing / unavailable) with the CTA inside it. Both surfaces
 * must be wired identically — a logged-in talent is redirected from the public
 * page to the dashboard view, so a gap on either one is a gap for real
 * visitors — hence the same assertions run against both pages and both viewers.
 *
 * Source-level assertions (the repo's pattern for page wiring, as in
 * `reveal-gate-dead-end.test.ts`): these files are server components wired to
 * Supabase, caching and Stripe, so rendering them here would test the mocks.
 * The panel's own behaviour is covered in
 * `test/unit/components/gated-search-panel.test.tsx`, and the branch ordering in
 * `test/unit/find-my-photos.test.ts`.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const publicPage = read('src/app/[lang]/events/[shareCode]/page.tsx');
const talentPage = read('src/app/[lang]/dashboard/talent/events/[id]/page.tsx');
const publicViewer = read('src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx');
const talentViewer = read('src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx');

for (const [name, page] of [
  ['public event page', publicPage],
  ['talent dashboard event view', talentPage],
] as const) {
  describe(`gated pre-search panel wired on the ${name} (T-230)`, () => {
    it('hands the panel copy + the event total to the viewer for a gated event', () => {
      expect(page).toContain('const gatedPanelLabels = dict.aiSearch.gatedPanel;');
      expect(page).toContain('gatedPanel={');
      // The total is the one fact the panel may show — it says nothing about
      // WHICH photos exist, so the gate is untouched.
      expect(page).toContain('photoCount: totalCount');
    });

    it('renders the processing / unavailable states as the same panel', () => {
      expect(page).toContain("gatedFaceSearchNotice !== 'none'");
      expect(page).toContain('<GatedSearchPanel');
      expect(page).toContain('state={gatedFaceSearchNotice}');
    });

    it('steps the outer search banner aside so only one CTA is offered', () => {
      expect(page).toContain('revealGated={gated}');
    });

    it('drops the header photo-count line while the panel states the same total', () => {
      expect(page).toContain('const gatedPanelOwnsGallery =');
      expect(page).toContain("eventStatus !== 'upcoming' && !gatedPanelOwnsGallery");
    });
  });
}

for (const [name, viewer] of [
  ['public event viewer', publicViewer],
  ['talent dashboard viewer', talentViewer],
] as const) {
  describe(`gated pre-search panel rendered by the ${name} (T-230)`, () => {
    it('renders the panel with the search CTA inside it', () => {
      expect(viewer).toContain(
        "import { GatedSearchPanel, type GatedSearchPanelLabels } from '@/components/gated-search-panel';",
      );
      expect(viewer).toContain('<GatedSearchPanel');
      expect(viewer).toContain('onSearch={faceSearch.openSearch}');
    });

    it('resolves the slot through the shared view resolver, not its own ordering', () => {
      expect(viewer).toContain("import { resolveEventGalleryView } from '@/lib/find-my-photos';");
      expect(viewer).toContain('resolveEventGalleryView({');
      // The regression: an active search must outrank an empty grid, or a gated
      // event answers a successful search with its empty state.
      expect(viewer).toContain("galleryView === 'search-results'");
    });
  });
}

describe('gated pre-search copy (T-230)', () => {
  const dicts = {
    en: JSON.parse(read('src/dictionaries/en.json')),
    es: JSON.parse(read('src/dictionaries/es.json')),
  } as Record<
    string,
    { aiSearch: { gatedPanel: Record<string, string> }; events: Record<string, string> }
  >;

  for (const [lang, dict] of Object.entries(dicts)) {
    it(`carries every panel string in ${lang}`, () => {
      const panel = dict.aiSearch.gatedPanel;
      for (const key of [
        'searchTitle',
        'searchDescription',
        'searchCta',
        'photoCount',
        'privacyNote',
        'processingTitle',
        'processingDescription',
        'unavailableTitle',
        'unavailableDescription',
      ]) {
        expect(panel[key], `${lang}.aiSearch.gatedPanel.${key}`).toBeTruthy();
      }
      expect(panel.photoCount).toContain('{count}');
    });

    it(`no longer sends the visitor "above" for the CTA in ${lang}`, () => {
      // The old copy pointed at a button in another component — the tell that
      // the CTA was in the wrong place. The panel owns it now.
      expect(dict.events.galleryGatedEmpty).not.toMatch(/\babove\b|\barriba\b/i);
    });
  }
});
