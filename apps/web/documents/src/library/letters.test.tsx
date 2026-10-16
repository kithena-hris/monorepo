import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { row } from '../test/acme.fixture';
import { axeViolations } from '../test/axe';
import { LettersDialog } from './letters';

describe('letters from a template (G3)', () => {
  it('previews one letter, then generates one per person chosen', async () => {
    const onGenerateLetters = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { ids: ['l-1'] } }),
    );
    render(
      <LettersDialog
        open
        onOpenChange={vi.fn()}
        templates={[
          row({ id: 't-1', title: 'Promotion letter', kind: 'Template', typeKey: 'template' }),
        ]}
        people={[{ personId: 'p-adam', name: 'Adam Novak', teamName: 'Platform' }]}
        onPreviewLetters={() =>
          Promise.resolve({
            ok: true,
            data: { preview: 'Dear Adam, from 1 November…', missing: [] },
          })
        }
        onGenerateLetters={onGenerateLetters}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write to Adam Novak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Dear Adam, from 1 November…')).toBeTruthy();
    // The dialog's next step renders after the preview settles; a loaded CI
    // runner took longer than findBy's default second (it failed twice there).
    fireEvent.click(await screen.findByRole('button', { name: 'Generate 1' }, { timeout: 5000 }));
    await vi.waitFor(() => {
      expect(onGenerateLetters).toHaveBeenCalledWith('t-1', 'Promotion letter', ['p-adam'], false);
    });
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
