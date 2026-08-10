import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-184: a reveal-gated event (T-177) reveals its photos
 * ONLY through a face-search match. When the event isn't searchable yet (nothing
 * indexed / indexing in flight / indexing failed) the face-search entry can't
 * render, so an unproven visitor was stranded with no photos AND no way to find
 * them — a silent dead-end.
 *
 * The fix computes `resolveGatedFaceSearchNotice(...)` server-side and renders a
 * clear state instead of the mute empty gallery. Both viewing surfaces must wire
 * it (logged-in talents are redirected to the dashboard view;
 * guests/photographers stay on the public page), so this pins the wiring on
 * both. Fails before the fix, passes after.
 *
 * T-230 replaced the standalone `<GatedFaceSearchNotice>` with the shared
 * `<GatedSearchPanel>`, which renders those two states plus the searchable one
 * at equal weight — the guard itself is unchanged, only what draws it.
 */

const talentPage = readFileSync(
  resolve(process.cwd(), 'src/app/[lang]/dashboard/talent/events/[id]/page.tsx'),
  'utf8',
);
const publicPage = readFileSync(
  resolve(process.cwd(), 'src/app/[lang]/events/[shareCode]/page.tsx'),
  'utf8',
);

for (const [name, source] of [
  ['talent dashboard event view', talentPage],
  ['public event page', publicPage],
] as const) {
  describe(`reveal-gate dead-end guard wired on the ${name} (T-184)`, () => {
    it('resolves the gated face-search notice server-side', () => {
      expect(source).toContain(
        "import { resolveGatedFaceSearchNotice } from '@/lib/find-my-photos';",
      );
      expect(source).toContain('const gatedFaceSearchNotice = resolveGatedFaceSearchNotice({');
    });

    it('renders the clear-state panel instead of a mute empty gallery', () => {
      expect(source).toContain(
        "import { GatedSearchPanel } from '@/components/gated-search-panel';",
      );
      expect(source).toContain("gatedFaceSearchNotice !== 'none'");
      expect(source).toContain('<GatedSearchPanel');
      expect(source).toContain('dict.aiSearch.gatedPanel');
    });
  });
}
