import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsActivity, changesIn } from './activity';

describe('changesIn', () => {
  it('reads a change log sentence as what changed, from and to', () => {
    expect(changesIn('Seen by: HR → HR and their manager. Required: No → Yes.')).toEqual([
      { what: 'Seen by', from: 'HR', to: 'HR and their manager' },
      { what: 'Required', from: 'No', to: 'Yes' },
    ]);
    expect(changesIn('Everyone signing up must fill it in.')).toBe(null);
  });
});

describe('SettingsActivity', () => {
  it('shows a person by their photo or initials, and the system by its icon', async () => {
    const entry = {
      at: '2026-09-29T09:00:00.000Z',
      action: 'Published the employee fields',
      subject: null,
      detail: null,
      area: 'fields',
    };
    const { container } = render(
      <SettingsActivity
        load={{
          status: 'ready',
          data: {
            entries: [
              {
                ...entry,
                id: 'a',
                by: 'You',
                name: 'Ada Lovelace',
                avatarUrl: null,
                kind: 'person',
              },
              { ...entry, id: 'b', by: 'System', name: 'System', avatarUrl: null, kind: 'system' },
            ],
            next: null,
          },
        }}
        area={null}
        onArea={() => undefined}
      />,
    );
    // Each "Who" cell: the avatar, then the name.
    const who = (label: string): Element | null => screen.getByText(label).closest('span');
    // The avatar waits a beat before its fallback, so a cached photo never flashes.
    await waitFor(() => {
      expect(who('You')?.textContent).toContain('AL');
    });
    expect(who('System')?.querySelector('svg')).not.toBeNull();
    expect(who('You')?.querySelector('svg')).toBeNull();
    expect(container.textContent).not.toContain('SY');
  });
});
