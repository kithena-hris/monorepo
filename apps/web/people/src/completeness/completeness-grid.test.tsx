import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { CompletenessGrid, type CompletenessState } from './completeness-grid';

const state: CompletenessState = {
  since: 'Since version 4 was published on 22 Sep',
  waiting: { people: 61, lastReminded: '2 days ago' },
  completedThisWeek: 34,
  fields: [
    {
      key: 'cost_centre',
      label: 'Cost centre',
      options: [
        { value: 'ENG-204', label: 'ENG-204' },
        { value: 'ENG-201', label: 'ENG-201' },
      ],
    },
    { key: 'desk', label: 'Desk', options: [] },
  ],
  rows: [
    {
      personId: 'l',
      name: 'Lena Moreau',
      department: 'Engineering',
      manager: 'Tomás Oliveira',
      missing: ['cost_centre', 'desk'],
    },
    {
      personId: 'j',
      name: 'Joan Bosch',
      department: 'Engineering',
      manager: 'Tomás Oliveira',
      missing: ['cost_centre'],
    },
    {
      personId: 'n',
      name: 'Nadia Petrova',
      department: 'Design',
      manager: 'Ingrid Sø',
      missing: ['cost_centre'],
    },
  ],
};

const pick = async (name: string, option: string) => {
  const user = fast();
  await user.click(screen.getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('CompletenessGrid', () => {
  it('is one grid over exactly the missing cells, with a real control in each', async () => {
    const { container } = render(
      <CompletenessGrid load={{ status: 'ready', data: state }} onSave={vi.fn()} />,
    );
    expect(screen.getAllByRole('combobox', { name: /^Cost centre for / })).toHaveLength(3);
    expect(screen.getByText('Waiting on employees')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('tabs down the column, not across the row', async () => {
    const user = fast();
    render(<CompletenessGrid load={{ status: 'ready', data: state }} onSave={vi.fn()} />);
    screen.getByRole('combobox', { name: 'Cost centre for Lena Moreau' }).focus();
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Cost centre for Joan Bosch' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Cost centre for Nadia Petrova' })).toHaveFocus();
  });

  it('saves one change per person, however many fields were filled for them', async () => {
    const user = fast();
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<CompletenessGrid load={{ status: 'ready', data: state }} onSave={onSave} />);
    await pick('Cost centre for Lena Moreau', 'ENG-204');
    await pick('Cost centre for Joan Bosch', 'ENG-201');
    // The next field's column: Lena again.
    await pick('Field', 'Desk');
    await user.type(screen.getByRole('textbox', { name: 'Desk for Lena Moreau' }), 'A-04');

    await user.click(screen.getByRole('button', { name: 'Save 3 changes' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith([
      { personId: 'l', values: { cost_centre: 'ENG-204', desk: 'A-04' } },
      { personId: 'j', values: { cost_centre: 'ENG-201' } },
    ]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });
  });

  it('keeps the edits and says why when the save is refused', async () => {
    const user = fast();
    render(
      <CompletenessGrid
        load={{ status: 'ready', data: state }}
        onSave={() => Promise.resolve({ ok: false, message: 'ENG-201 was retired' })}
      />,
    );
    await pick('Cost centre for Joan Bosch', 'ENG-201');
    await user.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(await screen.findByText('ENG-201 was retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save 1 change' })).toBeEnabled();
  });

  it('has loading, error and nothing-missing states', async () => {
    const { container, rerender } = render(
      <CompletenessGrid load={{ status: 'loading' }} onSave={vi.fn()} />,
    );
    expect(screen.getByText('Loading the missing information')).toBeInTheDocument();
    rerender(<CompletenessGrid load={{ status: 'error', message: 'Down' }} onSave={vi.fn()} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    rerender(
      <CompletenessGrid
        load={{ status: 'ready', data: { ...state, fields: [], rows: [] } }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('Nothing is missing')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
