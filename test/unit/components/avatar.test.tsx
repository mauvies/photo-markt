/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from '@/components/ui/avatar';

afterEach(cleanup);

describe('Avatar (base)', () => {
  it('rings every user avatar with a visible thin grey border by default (T-003)', () => {
    // The header avatar that prompted T-003 is rendered through this base
    // component (DashboardUserMenu, UserAvatar, bottom-nav). Putting the ring
    // here is what makes it show everywhere — border-input (#e3e3e3) was too
    // light to read on a white-background photo over the white header.
    const { container } = render(<Avatar />);
    const avatar = container.querySelector('[data-slot="avatar"]');
    expect(avatar?.className).toContain('border');
    expect(avatar?.className).toContain('border-muted-foreground/50');
  });

  it('lets a caller override the default border (e.g. profile border-2)', () => {
    const { container } = render(<Avatar className="border-2 border-border" />);
    const avatar = container.querySelector('[data-slot="avatar"]');
    // tailwind-merge keeps the override; both default tokens are dropped.
    expect(avatar?.className).toContain('border-2');
    expect(avatar?.className).toContain('border-border');
    expect(avatar?.className).not.toContain('border-muted-foreground/50');
  });
});
