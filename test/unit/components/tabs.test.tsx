/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

afterEach(cleanup);

function renderTabs(listProps?: { variant?: 'default' | 'line' }) {
  return render(
    <Tabs value="a">
      <TabsList {...listProps}>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
      </TabsList>
    </Tabs>,
  );
}

describe('Tabs (app-wide underline standard, T-013)', () => {
  it('defaults to the underline (line) variant', () => {
    const { container } = renderTabs();
    const list = container.querySelector('[data-slot="tabs-list"]');
    expect(list?.getAttribute('data-variant')).toBe('line');
  });

  it('still allows opting back into the segmented (default) variant', () => {
    const { container } = renderTabs({ variant: 'default' });
    const list = container.querySelector('[data-slot="tabs-list"]');
    expect(list?.getAttribute('data-variant')).toBe('default');
  });

  it('marks the active tab with a primary-colored bottom underline', () => {
    const { container } = renderTabs();
    const trigger = container.querySelector('[data-slot="tabs-trigger"]');
    // The underline is the `after:` bar; it must be primary (like Favorites),
    // not the previous foreground/black.
    expect(trigger?.className).toContain('after:bg-primary');
    expect(trigger?.className).not.toContain('after:bg-foreground');
  });
});
