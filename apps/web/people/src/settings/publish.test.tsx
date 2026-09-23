import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import type { PublishPreview } from './model';
import { PublishDialog } from './publish';

const preview: PublishPreview = {
  nextVersion: 4,
  unchanged: false,
  changes: [
    {
      kind: 'added',
      key: 'cost_centre',
      summary: 'Cost centre added to HR information, required for everyone',
      specialCategory: false,
    },
    {
      kind: 'tightened',
      key: 'home_address',
      summary: 'Home address now required for employees in Spain',
      specialCategory: false,
    },
    {
      kind: 'archived',
      key: 'shirt_size',
      summary: 'Shirt size archived. Existing answers are kept.',
      specialCategory: false,
    },
    {
      kind: 'added',
      key: 'accommodation_notes',
      summary: 'Accommodation notes added to Health & safety',
      specialCategory: true,
    },
  ],
  impact: {
    evaluated: 412,
    becomingIncomplete: 88,
    becomingComplete: 0,
    forEmployees: 61,
    forStaff: 27,
  },
  integrationsNotified: 3,
};

function stat(label: string): string | null | undefined {
  // A Stat is its label then its value; read the value beside the label.
  return screen.getByText(label).closest('div')?.parentElement?.querySelector('p.tabular-nums')
    ?.textContent;
}

describe('PublishDialog', () => {
  it('shows exactly the numbers the preview computed', async () => {
    render(
      <PublishDialog
        open
        onOpenChange={vi.fn()}
        today="2026-09-23"
        preview={() => Promise.resolve(preview)}
        onPublish={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Publish version 4' });
    expect(within(dialog).getByText('Impact on 412 people')).toBeInTheDocument();
    expect(stat('Become incomplete')).toBe('88');
    expect(stat('For employees to fill')).toBe('61');
    expect(stat('For you to fill')).toBe('27');
    expect(stat('Integrations notified')).toBe('3');
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('marks each change with a glyph and a word, never colour alone', async () => {
    render(
      <PublishDialog
        open
        onOpenChange={vi.fn()}
        today="2026-09-23"
        preview={() => Promise.resolve(preview)}
        onPublish={vi.fn()}
      />,
    );
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '+ AddedCost centre added to HR information, required for everyone',
      '~ TightenedHome address now required for employees in Spain',
      '− ArchivedShirt size archived. Existing answers are kept.',
      '+ AddedAccommodation notes added to Health & safetySpecial category',
    ]);
  });

  it('asks again when requiredFrom moves, and publishes with the date chosen', async () => {
    const user = fast();
    const ask = vi.fn(() => Promise.resolve(preview));
    const onPublish = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onOpenChange = vi.fn();
    render(
      <PublishDialog
        open
        onOpenChange={onOpenChange}
        today="2026-09-23"
        preview={ask}
        onPublish={onPublish}
      />,
    );
    await screen.findByRole('dialog', { name: 'Publish version 4' });
    expect(ask).toHaveBeenLastCalledWith('2026-09-23');

    await user.click(screen.getByRole('button', { name: /Required from/ }));
    await user.click(await screen.findByRole('button', { name: /30 September|September 30/ }));
    await waitFor(() => {
      expect(ask).toHaveBeenLastCalledWith('2026-09-30');
    });

    await user.click(await screen.findByRole('button', { name: 'Publish version 4' }));
    expect(onPublish).toHaveBeenCalledWith('2026-09-30');
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('says what went wrong and keeps the dialog open when publishing is refused', async () => {
    const user = fast();
    render(
      <PublishDialog
        open
        onOpenChange={vi.fn()}
        today="2026-09-23"
        preview={() => Promise.resolve(preview)}
        onPublish={() =>
          Promise.resolve({ ok: false, message: 'Somebody published version 4 first' })
        }
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Publish version 4' }));
    expect(await screen.findByText('Somebody published version 4 first')).toBeInTheDocument();
  });

  it('has loading, error and nothing-to-publish states', async () => {
    const user = fast();
    const { rerender } = render(
      <PublishDialog
        open
        onOpenChange={vi.fn()}
        today="2026-09-23"
        preview={() => new Promise(() => undefined)}
        onPublish={vi.fn()}
      />,
    );
    expect(await screen.findByText('Working out what this changes')).toBeInTheDocument();
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);

    const failing = vi.fn(() => Promise.reject(new Error('down')));
    rerender(
      <PublishDialog
        open
        onOpenChange={vi.fn()}
        today="2026-09-23"
        preview={failing}
        onPublish={vi.fn()}
      />,
    );
    expect(await screen.findByText('Could not work out what this changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(failing).toHaveBeenCalledTimes(2);
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);

    rerender(
      <PublishDialog
        open
        onOpenChange={vi.fn()}
        today="2026-09-23"
        preview={() => Promise.resolve({ ...preview, unchanged: true })}
        onPublish={vi.fn()}
      />,
    );
    expect(await screen.findByText('Nothing to publish')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish version 4' })).toBeDisabled();
  });
});
