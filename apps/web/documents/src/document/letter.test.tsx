import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { ActOnLetter } from './letter';

describe('a letter that changes a record (J7)', () => {
  it('reads the last working day and gives notice once HR saves', async () => {
    const onGiveNotice = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <ActOnLetter
        documentId="d-1"
        onReadLetter={() =>
          Promise.resolve({
            ok: true,
            data: {
              personId: 'p-omar',
              name: 'Omar Haddad',
              lastWorkingDay: { value: '2026-11-30', page: 1 },
            },
          })
        }
        onGiveNotice={onGiveNotice}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Act on this letter' }));
    expect(await screen.findByText(/last working day/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onGiveNotice).toHaveBeenCalledWith('p-omar', '2026-11-30');
    expect(await screen.findByText('Their notice is in their record.')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
