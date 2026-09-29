import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { CompletenessGrid, type CompletenessState } from './completeness-grid';

const state: CompletenessState = {
  since: 'Since version 4 was published on 22 Sep',
  waiting: { people: 61, lastReminded: '2026-09-21T08:00:00.000Z', due: 61 },
  completedThisWeek: 34,
  toFill: 4,
  blocking: 4,
  complete: {
    percent: 79,
    incomplete: 88,
    change: 6,
    trend: [
      { label: '2026-07', value: 71 },
      { label: '2026-08', value: 73 },
      { label: '2026-09', value: 79 },
    ],
  },
  fields: [
    {
      key: 'cost_centre',
      label: 'Cost centre',
      options: [
        { value: 'ENG-204', label: 'ENG-204' },
        { value: 'ENG-201', label: 'ENG-201' },
      ],
      person: false,
    },
    { key: 'desk', label: 'Desk', options: [], person: false },
    { key: 'emergency_contact', label: 'Emergency contact', options: [], person: false },
    { key: 'iban', label: 'Bank account', options: [], person: false },
  ],
  rows: [
    {
      personId: 'l',
      name: 'Lena Moreau',
      department: 'Engineering',
      manager: 'Tomás Oliveira',
      missing: ['cost_centre', 'desk'],
      owner: 'hr',
      remindedAt: null,
    },
    {
      personId: 'j',
      name: 'Joan Bosch',
      department: 'Engineering',
      manager: 'Tomás Oliveira',
      missing: ['cost_centre'],
      owner: 'hr',
      remindedAt: null,
    },
    {
      personId: 'n',
      name: 'Nadia Petrova',
      department: 'Design',
      manager: 'Ingrid Sø',
      missing: ['cost_centre'],
      owner: 'hr',
      remindedAt: null,
    },
    {
      personId: 'u',
      name: 'Lucía Fernández',
      department: 'Sales',
      manager: null,
      missing: ['emergency_contact'],
      owner: 'employee',
      remindedAt: null,
    },
    {
      personId: 'o',
      name: 'Omar Haddad',
      department: 'Sales',
      manager: null,
      missing: ['iban'],
      owner: 'employee',
      // The weekly email went out a fortnight ago.
      remindedAt: '2026-09-08T08:00:00.000Z',
    },
  ],
};

/** "Fill in" on a person's row: the grid, at their first missing cell. */
const fillIn = async (name = 'Lena Moreau') => {
  const [atDesk] = screen.getAllByRole('button', { name: `Fill in ${name}` });
  if (atDesk !== undefined) await fast().click(atDesk);
};

const pick = async (name: string, option: string) => {
  const user = fast();
  await user.click(screen.getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('CompletenessGrid', () => {
  it('lists who is missing what, titled as Data health', async () => {
    const { container } = render(
      <CompletenessGrid load={{ status: 'ready', data: state }} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Data health' })).toBeInTheDocument();
    expect(screen.getByText('Waiting on employees')).toBeInTheDocument();
    expect(screen.getByText('For HR to fill in')).toBeInTheDocument();
    const table = screen.getByRole('grid', { name: 'Missing information' });
    expect(within(table).getByText('Desk')).toBeInTheDocument();
    expect(within(table).getAllByText('HR')).toHaveLength(3);
    // The person's own gaps are listed too, as theirs to fill.
    expect(within(table).getAllByText('Employee')).toHaveLength(2);
    expect(within(table).getByText('Bank account')).toBeInTheDocument();
    // Nothing to fill in yet: the grid opens from a row.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens one grid over exactly the missing cells from Fill in, at that person', async () => {
    const { container } = render(
      <CompletenessGrid load={{ status: 'ready', data: state }} onSave={vi.fn()} />,
    );
    await fillIn('Joan Bosch');
    expect(screen.getAllByRole('combobox', { name: /^Cost centre for / })).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: 'Cost centre for Joan Bosch' })).toHaveFocus();
    expect(await axeViolations(container)).toEqual([]);
    await fast().click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('tabs across the row, and Enter moves down the column', async () => {
    const user = fast();
    const rows = [
      ...state.rows,
      {
        personId: 'k',
        name: 'Kai Lund',
        department: null,
        manager: null,
        missing: ['desk'],
        owner: 'hr' as const,
        remindedAt: null,
      },
    ];
    render(
      <CompletenessGrid load={{ status: 'ready', data: { ...state, rows } }} onSave={vi.fn()} />,
    );
    await fillIn();
    screen.getByRole('combobox', { name: 'Cost centre for Lena Moreau' }).focus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Desk for Lena Moreau' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Desk for Kai Lund' })).toHaveFocus();
  });

  it('saves one change per person, however many fields were filled for them', async () => {
    const user = fast();
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<CompletenessGrid load={{ status: 'ready', data: state }} onSave={onSave} />);
    await fillIn();
    await pick('Cost centre for Lena Moreau', 'ENG-204');
    await pick('Cost centre for Joan Bosch', 'ENG-201');
    // The next column over: Lena again.
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
    await fillIn();
    await pick('Cost centre for Joan Bosch', 'ENG-201');
    await user.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(await screen.findByText('ENG-201 was retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save 1 change' })).toBeEnabled();
  });

  it('counts over everybody, and pages rather than stopping at the first people (PEO-122)', async () => {
    const user = fast();
    const onNextPage = vi.fn();
    const { container } = render(
      <CompletenessGrid
        load={{ status: 'ready', data: { ...state, toFill: 4210 } }}
        onSave={vi.fn()}
        onNextPage={onNextPage}
        onFirstPage={vi.fn()}
      />,
    );
    // The stat is People's count over every page, not this page's three rows.
    expect(screen.getByText('4210')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onNextPage).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'First page' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('picks a person by searching People, not from a list it was handed', async () => {
    const user = fast();
    const searchPeople = vi.fn((text: string) =>
      Promise.resolve(text === 'ing' ? [{ value: 'i', label: 'Ingrid Sø' }] : []),
    );
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <CompletenessGrid
        load={{
          status: 'ready',
          data: {
            ...state,
            fields: [{ key: 'manager', label: 'Manager', options: [], person: true }],
            rows: state.rows.slice(0, 1).map((r) => ({ ...r, missing: ['manager'] })),
          },
        }}
        onSave={onSave}
        searchPeople={searchPeople}
      />,
    );
    await fillIn();
    await user.click(screen.getByRole('button', { name: 'Manager for Lena Moreau' }));
    await user.type(
      screen.getByRole('combobox', { name: 'Manager for Lena Moreau search' }),
      'ing',
    );
    await user.click(await screen.findByRole('option', { name: 'Ingrid Sø' }));
    expect(searchPeople).toHaveBeenLastCalledWith('ing');
    await user.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(onSave).toHaveBeenCalledWith([{ personId: 'l', values: { manager: 'i' } }]);
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

  it('warns on a doubted identifier in its own cell, then saves it anyway (PEO-125)', async () => {
    const user = fast();
    const nif: CompletenessState = {
      ...state,
      fields: [{ key: 'es_nif', label: 'NIF', options: [], person: false }],
      rows: [
        {
          personId: 'j',
          name: 'Joan Bosch',
          department: null,
          manager: null,
          missing: ['es_nif'],
          owner: 'hr',
          remindedAt: null,
        },
      ],
    };
    const finding = {
      personId: 'j',
      key: 'es_nif',
      label: 'NIF',
      level: 'mismatch' as const,
      code: 'check_mismatch',
      message: 'Matches the national format, but the control letter does not compute.',
    };
    const onCheck = vi.fn(() =>
      Promise.resolve({ ok: true as const, findings: [{ ...finding, review: 'none' as const }] }),
    );
    const onSave = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        findings: [{ ...finding, review: 'pending' as const }],
      }),
    );
    const { container } = render(
      <CompletenessGrid load={{ status: 'ready', data: nif }} onSave={onSave} onCheck={onCheck} />,
    );
    await fillIn('Joan Bosch');
    await user.type(screen.getByRole('textbox', { name: 'NIF for Joan Bosch' }), '12345678A');
    await user.click(screen.getByRole('button', { name: 'Save 1 change' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'NIF for Joan Bosch' })).toHaveAccessibleDescription(
      /control letter does not compute/,
    );
    expect(screen.getByText('Our checks suggest some of these may be wrong')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(onSave).toHaveBeenCalledWith([{ personId: 'j', values: { es_nif: '12345678A' } }]);
    expect(
      await screen.findByText(/1 value our checks doubted went to HR's review/),
    ).toBeInTheDocument();
  });
});

describe('CompletenessGrid, the figures and reminders (V4, MV2)', () => {
  it('shows the four figures, with the change this month and its sparkline', () => {
    render(<CompletenessGrid load={{ status: 'ready', data: state }} onSave={vi.fn()} />);
    expect(screen.getByText('+6 pts')).toBeInTheDocument();
    expect(screen.getByText('this month')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Complete records by month' })).toBeInTheDocument();
    expect(screen.getByText(/^Last reminded 21 Sept?$/)).toBeInTheDocument();
    expect(screen.getByText('Blocking payroll')).toBeInTheDocument();
    expect(screen.getByText('Bank, tax or ID details')).toBeInTheDocument();
  });

  it('shows no figure People could not give, rather than a zero', () => {
    const bare: CompletenessState = {
      ...state,
      blocking: null,
      complete: { percent: 79, incomplete: 88, change: null, trend: [] },
    };
    render(<CompletenessGrid load={{ status: 'ready', data: bare }} onSave={vi.fn()} />);
    expect(screen.queryByText('Blocking payroll')).toBeNull();
    expect(screen.queryByText(/pts/)).toBeNull();
    expect(screen.queryByRole('table', { name: 'Complete records by month' })).toBeNull();
    expect(screen.getByText('88 records incomplete')).toBeInTheDocument();
  });

  it('reminds everybody due at once, and says who was not due', async () => {
    const onRemindAll = vi.fn(() =>
      Promise.resolve({ ok: true as const, sent: 40, failed: 0, skipped: 21 }),
    );
    const { container } = render(
      <CompletenessGrid
        load={{ status: 'ready', data: state }}
        onSave={vi.fn()}
        onRemindAll={onRemindAll}
      />,
    );
    await fast().click(screen.getByRole('button', { name: 'Remind 61 people' }));
    expect(onRemindAll).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Sent 40 reminders\. 21 people were not due/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers no bulk reminder when nobody is due, or it cannot be sent from here', () => {
    const { rerender } = render(
      <CompletenessGrid
        load={{ status: 'ready', data: { ...state, waiting: { ...state.waiting, due: 0 } } }}
        onSave={vi.fn()}
        onRemindAll={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Remind \d/ })).toBeNull();
    rerender(<CompletenessGrid load={{ status: 'ready', data: state }} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Remind \d/ })).toBeNull();
  });

  it('reminds one person of their own fields, and not twice in a day', async () => {
    const onRemind = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <CompletenessGrid
        load={{
          status: 'ready',
          data: {
            ...state,
            rows: state.rows.map((r) =>
              r.personId === 'u' ? { ...r, remindedAt: new Date().toISOString() } : r,
            ),
          },
        }}
        onSave={vi.fn()}
        onRemind={onRemind}
      />,
    );
    // Lucía was asked today: nothing to press.
    const [lucia] = screen.getAllByRole('button', { name: 'Reminded Lucía Fernández' });
    expect(lucia).toBeDisabled();
    // Omar's weekly email was a fortnight ago.
    const [omar] = screen.getAllByRole('button', { name: 'Remind Omar Haddad' });
    if (omar !== undefined) await fast().click(omar);
    expect(onRemind).toHaveBeenCalledWith('o', ['iban']);
    expect(screen.getAllByRole('button', { name: 'Reminded Omar Haddad' })[0]).toBeDisabled();
  });

  it('keeps Fill in for HR’s rows only, and opens the grid over them alone', async () => {
    render(<CompletenessGrid load={{ status: 'ready', data: state }} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Fill in Omar Haddad' })).toBeNull();
    await fillIn();
    expect(screen.queryByRole('textbox', { name: /Bank account/ })).toBeNull();
    expect(screen.queryByText('Omar Haddad')).toBeNull();
  });
});
