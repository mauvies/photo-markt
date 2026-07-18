import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-147: the `/photographers` hero was redesigned away from
 * the default-template look (a gradient background with two blurred blobs + a
 * gradient-clipped headline) toward a deliberate camera metaphor (rule-of-thirds
 * grid + viewfinder corner brackets). These assertions fail before the redesign
 * and pass after, and keep the template markers from creeping back into the hero.
 *
 * We scope to the hero by only inspecting the source up to the "How It Works"
 * marker — the rest of the page (final CTA) legitimately keeps a soft gradient.
 */

const root = process.cwd();

function readHeroSource(): string {
  const full = readFileSync(resolve(root, 'src/app/[lang]/photographers/page.tsx'), 'utf8');
  const heroEnd = full.indexOf('{/* How It Works */}');
  expect(heroEnd).toBeGreaterThan(0);
  return full.slice(0, heroEnd);
}

describe('photographers hero redesign (T-147)', () => {
  it('drops the template markers (blur blobs + gradient-clipped headline)', () => {
    const hero = readHeroSource();
    expect(hero).not.toContain('blur-3xl');
    expect(hero).not.toContain('bg-clip-text');
    expect(hero).not.toContain('text-transparent');
  });

  it('renders the deliberate camera-framing signature', () => {
    const hero = readHeroSource();
    // Viewfinder corner brackets use directional 2px borders in the brand color.
    expect(hero).toContain('border-primary/40');
    // Rule-of-thirds framing grid at the thirds.
    expect(hero).toContain('left-1/3');
    expect(hero).toContain('top-2/3');
    // The new sports-photography eyebrow.
    expect(hero).toContain('heroEyebrow');
  });

  it('preserves the headline, subtitle and the single primary CTA', () => {
    const hero = readHeroSource();
    expect(hero).toContain('heroHeadline1');
    expect(hero).toContain('heroHeadline2');
    expect(hero).toContain('heroSubtitle');
    expect(hero).toContain('heroCta');
    expect(hero).toContain('signupHref');
  });

  it('keeps the new hero eyebrow string in both dictionaries', () => {
    const en = JSON.parse(readFileSync(resolve(root, 'src/dictionaries/en.json'), 'utf8'));
    const es = JSON.parse(readFileSync(resolve(root, 'src/dictionaries/es.json'), 'utf8'));
    expect(en.photographersPage.heroEyebrow).toBeTruthy();
    expect(es.photographersPage.heroEyebrow).toBeTruthy();
  });
});
