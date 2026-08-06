/** @vitest-environment happy-dom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventCoverField } from '@/components/event-cover-field';

const labels = {
  label: 'Cover image',
  desc: 'Shown on the card',
  infoAria: 'More info',
  select: 'Choose a cover image',
  remove: 'Remove',
};

afterEach(cleanup);

describe('EventCoverField (T-166 shared component)', () => {
  it('empty state shows the select prompt and a file input', () => {
    render(<EventCoverField previewUrl={null} onCoverChange={vi.fn()} labels={labels} />);
    expect(screen.getByText('Choose a cover image')).toBeTruthy();
    const input = document.getElementById('cover-image') as HTMLInputElement;
    expect(input?.type).toBe('file');
  });

  it('reports the picked file via onCoverChange', () => {
    const onChange = vi.fn();
    render(<EventCoverField previewUrl={null} onCoverChange={onChange} labels={labels} />);
    const input = document.getElementById('cover-image') as HTMLInputElement;
    const file = new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onChange).toHaveBeenCalledWith(file);
  });

  it('filled state shows the preview and a remove control that clears the cover', () => {
    const onChange = vi.fn();
    render(<EventCoverField previewUrl="blob:preview" onCoverChange={onChange} labels={labels} />);
    const img = screen.getByAltText('Cover image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:preview');
    fireEvent.click(screen.getByText('Remove'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('supports a custom input id (so two surfaces can coexist)', () => {
    render(
      <EventCoverField
        previewUrl={null}
        onCoverChange={vi.fn()}
        labels={labels}
        inputId="edit-cover-image"
      />,
    );
    expect(document.getElementById('edit-cover-image')).toBeTruthy();
  });

  it('disables the input while busy', () => {
    render(<EventCoverField previewUrl={null} onCoverChange={vi.fn()} labels={labels} busy />);
    const input = document.getElementById('cover-image') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});

/**
 * T-166: the event edit form must expose cover management, wired to the
 * standalone owner-only cover actions (the create wizard already has this; the
 * edit form did not). Source-level guard — fails before the feature, passes
 * after.
 */
describe('edit form cover wiring (T-166)', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-form.tsx',
    ),
    'utf8',
  );

  it('renders the shared EventCoverField', () => {
    expect(source).toContain("import { EventCoverField } from '@/components/event-cover-field';");
    expect(source).toContain('<EventCoverField');
  });

  it('persists via the shared cover uploader + the standalone remove action', () => {
    // T-238 replaced the byte-carrying `uploadEventCoverAction` with the
    // direct-to-Storage `uploadEventCover` helper; remove has no bytes and stayed.
    expect(source).toContain('uploadEventCover');
    expect(source).toContain('removeEventCoverAction');
  });

  it('seeds the preview from the signed initial cover url', () => {
    expect(source).toContain('initialCoverUrl');
  });
});
