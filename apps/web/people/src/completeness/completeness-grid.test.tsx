import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import {
  MissingDetails,
  grouped,
  type CompletenessState,
  type GapRow,
  type MissingView,
} from './completeness-grid';
import { renderReview } from '../review/review.fixture';

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

/** The view opened on the people who fill in their own. */
const employees: MissingView = { lane: 'employees', q: null, team: null, field: null, group: null };

/** The rows in the list, as text. */
const listed = () => screen.getByRole('list', { name: 'Missing information' });

const kai: GapRow = {
  personId: 'k',
  name: 'Kai Lund',
  department: null,
  manager: null,
  missing: ['desk'],
  owner: 'hr',
  remindedAt: null,
};

/** "Fill in for all": the grid over every gap HR fills. */
const fillAll = async () => {
  await fast().click(screen.getByRole('button', { name: 'Fill in for all' }));
};

/** "Fill in" on a person's row: the dialog for their gaps alone. */
const fillIn = async (name = 'Lena Moreau') => {
  const [atDesk] = screen.getAllByRole('button', { name: `Fill in ${name}` });
  if (atDesk !== undefined) await fast().click(atDesk);
};

/**
 * A choice in a grid cell: the cell is plain until pressed, and the press
 * brings in the list already open.
 */
const pick = async (name: string, option: string) => {
  const user = fast();
  await user.click(screen.getByRole('textbox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('Missing details', () => {
  it('lists HR’s own gaps first, one narrow row each, its action beside the name', async () => {
    const { container } = render(<MissingDetails state={state} onSave={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /^For you to fill in/ })).toBeChecked();
    expect(within(listed()).getByText('Missing: Cost centre, Desk')).toBeInTheDocument();
    expect(within(listed()).getAllByText('Engineering · Tomás Oliveira')).toHaveLength(2);
    expect(within(listed()).getAllByRole('button', { name: /^Fill in / })).toHaveLength(3);
    // The people's own gaps are the other lane, not mixed in.
    expect(within(listed()).queryByText('Omar Haddad')).toBeNull();
    // Nothing to fill in yet: the grid opens from "Fill in for all", one person from their row.
    expect(screen.getByRole('button', { name: 'Fill in for all' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /for Lena Moreau$/ })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('switches to the people who fill in their own, and chases them from there', async () => {
    const onViewChange = vi.fn();
    render(
      <MissingDetails
        state={state}
        onSave={vi.fn()}
        onRemind={vi.fn()}
        onRemindAll={vi.fn()}
        onViewChange={onViewChange}
      />,
    );
    await fast().click(screen.getByRole('radio', { name: /^Waiting on employees/ }));
    expect(onViewChange).toHaveBeenCalledWith({ lane: 'employees' });
    expect(within(listed()).getByText('Missing: Bank account')).toBeInTheDocument();
    expect(within(listed()).queryByText('Lena Moreau')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remind 61 people waiting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fill in for all' })).toBeNull();
  });

  it('opens on the people’s lane when HR has nothing of its own to fill in', () => {
    render(
      <MissingDetails
        state={{ ...state, rows: state.rows.filter((r) => r.owner !== 'hr') }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /^Waiting on employees/ })).toBeChecked();
  });

  it('finds a person, narrows by team and by field, and clears it all at once', async () => {
    const user = fast();
    const { container } = render(<MissingDetails state={state} onSave={vi.fn()} />);
    await user.type(screen.getByRole('searchbox', { name: 'Find a person' }), 'joan');
    expect(within(listed()).getByText('Joan Bosch')).toBeInTheDocument();
    expect(within(listed()).queryByText('Lena Moreau')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(within(listed()).getByText('Lena Moreau')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Team' }));
    await user.click(await screen.findByRole('option', { name: 'Design' }));
    expect(within(listed()).getByText('Nadia Petrova')).toBeInTheDocument();
    expect(within(listed()).queryByText('Joan Bosch')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await user.click(screen.getByRole('combobox', { name: 'Missing field' }));
    await user.click(await screen.findByRole('option', { name: 'Desk' }));
    expect(within(listed()).getByText('Lena Moreau')).toBeInTheDocument();
    expect(within(listed()).queryByText('Joan Bosch')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says so when nobody loaded matches, rather than an empty list', () => {
    render(
      <MissingDetails
        state={state}
        onSave={vi.fn()}
        view={{ ...employees, lane: 'hr', q: 'zzz' }}
        onViewChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Nobody matches')).toBeInTheDocument();
  });

  it('groups the rows under headings a link can name', () => {
    render(
      <MissingDetails
        state={state}
        onSave={vi.fn()}
        view={{ ...employees, lane: 'hr', group: 'team' }}
        onViewChange={vi.fn()}
      />,
    );
    expect(within(listed()).getByText('Design')).toBeInTheDocument();
    expect(within(listed()).getByText('Engineering')).toBeInTheDocument();
  });

  it('opens one grid over every gap HR fills from "Fill in for all", and back', async () => {
    const { container } = render(<MissingDetails state={state} onSave={vi.fn()} />);
    await fillAll();
    expect(screen.getByRole('heading', { name: 'Fill in for HR' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: /^Cost centre for / })).toHaveLength(3);
    expect(await axeViolations(container)).toEqual([]);
    await fast().click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(screen.queryByRole('heading', { name: 'Fill in for HR' })).toBeNull();
  });

  it('opens a dialog for one person’s gaps alone from Fill in on their row (E6)', async () => {
    const onFillChange = vi.fn();
    render(
      <MissingDetails state={state} onSave={vi.fn()} fill={null} onFillChange={onFillChange} />,
    );
    await fillIn('Lena Moreau');
    // At once, before the address echoes it.
    const dialog = screen.getByRole('dialog', { name: 'Fill in for Lena Moreau' });
    expect(onFillChange).toHaveBeenCalledWith('l');
    expect(within(dialog).getByRole('combobox', { name: 'Cost centre' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Desk' })).toBeInTheDocument();
    // Hers alone: nobody else's cells, and none of the employee's own.
    expect(within(dialog).queryByText(/Joan Bosch/)).toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: 'Bank account' })).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('saves one person’s answers from their dialog, closes it, and drops what was filled', async () => {
    const user = fast();
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<MissingDetails state={state} onSave={onSave} />);
    await fillIn('Lena Moreau');
    const dialog = screen.getByRole('dialog', { name: 'Fill in for Lena Moreau' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Desk' }), 'A-04');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith([{ personId: 'l', values: { desk: 'A-04' } }]);
    expect(
      await screen.findByText(/Lena Moreau’s record now carries what you filled in/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The desk is no longer missing; the cost centre still is.
    expect(within(listed()).queryByText('Missing: Cost centre, Desk')).toBeNull();
    expect(within(listed()).getAllByText('Missing: Cost centre')).toHaveLength(3);
  });

  it('opens the dialog a link names, as the server sends it (E6)', () => {
    renderReview({ completeness: state }, { kind: 'missing', fill: 'j', onFillChange: vi.fn() });
    expect(screen.getByRole('dialog', { name: 'Fill in for Joan Bosch' })).toBeInTheDocument();
  });

  it('opens the dialog for somebody past the first page, read on their own', () => {
    render(<MissingDetails state={{ ...state, named: [kai] }} fill="k" onSave={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Fill in for Kai Lund' });
    expect(within(dialog).getByRole('textbox', { name: 'Desk' })).toBeInTheDocument();
  });

  it('draws each kind of value with its own control, in the grid and in the dialog', async () => {
    const typed: CompletenessState = {
      ...state,
      fields: [
        {
          key: 'contract_end',
          label: 'Contract end',
          dataType: 'date',
          options: [],
          person: false,
        },
        {
          key: 'equipment',
          label: 'Equipment',
          dataType: 'multi_select',
          options: [{ value: 'laptop', label: 'Laptop' }],
          person: false,
        },
        { key: 'remote', label: 'Remote', dataType: 'boolean', options: [], person: false },
        {
          key: 'allowance',
          label: 'Allowance',
          dataType: 'money',
          currency: 'EUR',
          options: [],
          person: false,
        },
        { key: 'work_email', label: 'Work email', dataType: 'email', options: [], person: false },
        {
          key: 'iban',
          label: 'Bank account',
          dataType: 'bank_account',
          options: [],
          person: false,
        },
      ],
      rows: [
        {
          personId: 'l',
          name: 'Lena Moreau',
          department: null,
          manager: null,
          missing: ['contract_end', 'equipment', 'remote', 'allowance', 'work_email', 'iban'],
          owner: 'hr',
          remindedAt: null,
        },
      ],
    };
    const { unmount } = render(<MissingDetails state={typed} onSave={vi.fn()} />);
    await fillAll();
    const user = fast();
    // A picker is a plain cell until pressed; pressed, a date is a date picker,
    // open, never a text box that holds a date.
    const date = screen.getByRole('textbox', { name: 'Contract end for Lena Moreau' });
    expect(date).toHaveAttribute('readonly');
    await user.click(date);
    expect(
      screen.getByRole('button', { name: /^Contract end for Lena Moreau: / }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Contract end for Lena Moreau' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('switch', { name: 'Remote for Lena Moreau' })).toBeInTheDocument();
    // Money, used, is the currency field with the decimal keypad.
    await user.click(screen.getByRole('textbox', { name: 'Allowance for Lena Moreau' }));
    expect(screen.getByRole('textbox', { name: 'Allowance for Lena Moreau' })).toHaveAttribute(
      'inputmode',
      'decimal',
    );
    const email = screen.getByRole('textbox', { name: 'Work email for Lena Moreau' });
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocorrect', 'off');
    expect(screen.getByRole('textbox', { name: 'Bank account for Lena Moreau' })).toHaveAttribute(
      'spellcheck',
      'false',
    );
    unmount();

    render(<MissingDetails state={typed} fill="l" onSave={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Fill in for Lena Moreau' });
    expect(within(dialog).getByRole('button', { name: /^Contract end: / })).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Remote' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Work email' })).toHaveAttribute(
      'type',
      'email',
    );
  });

  it('searches a long list of choices, and says so when a list has none', async () => {
    const user = fast();
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    const countries = [
      ...Array.from({ length: 40 }, (_, i) => ({
        value: `Q${String(i)}`,
        label: `Country ${String(i)}`,
      })),
      { value: 'JP', label: 'Japan' },
    ];
    render(
      <MissingDetails
        state={{
          ...state,
          fields: [
            {
              key: 'nationality',
              label: 'Nationality',
              dataType: 'country',
              options: countries,
              person: false,
            },
            { key: 'team', label: 'Team', dataType: 'org_unit_ref', options: [], person: false },
          ],
          rows: [{ ...(state.rows[0] as GapRow), missing: ['nationality', 'team'] }],
        }}
        onSave={onSave}
      />,
    );
    await fillAll();
    await user.click(screen.getByRole('textbox', { name: 'Nationality for Lena Moreau' }));
    await user.type(
      screen.getByRole('combobox', { name: 'Nationality for Lena Moreau search' }),
      'Jap',
    );
    await user.click(await screen.findByRole('option', { name: 'Japan' }));
    // Nothing to pick from is said, not drawn as a list that opens empty.
    expect(screen.getByRole('combobox', { name: 'Team for Lena Moreau' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Team for Lena Moreau' })).toHaveTextContent(
      'Nothing to choose from',
    );
    await user.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(onSave).toHaveBeenCalledWith([{ personId: 'l', values: { nationality: 'JP' } }]);
  });

  it('saves a typed value as itself, not as text', async () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <MissingDetails
        state={{
          ...state,
          fields: [
            { key: 'remote', label: 'Remote', dataType: 'boolean', options: [], person: false },
          ],
          rows: [{ ...(state.rows[0] as GapRow), missing: ['remote'] }],
        }}
        onSave={onSave}
      />,
    );
    await fillAll();
    await fast().click(screen.getByRole('switch', { name: 'Remote for Lena Moreau' }));
    await fast().click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(onSave).toHaveBeenCalledWith([{ personId: 'l', values: { remote: true } }]);
  });

  it('tabs across the row, and Enter moves down the column', async () => {
    const user = fast();
    render(<MissingDetails state={{ ...state, rows: [...state.rows, kai] }} onSave={vi.fn()} />);
    await fillAll();
    // Reached by Tab, a plain cell gives way to its control with the focus in it.
    act(() => {
      screen.getByRole('textbox', { name: 'Cost centre for Lena Moreau' }).focus();
    });
    expect(screen.getByRole('combobox', { name: 'Cost centre for Lena Moreau' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Desk for Lena Moreau' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Desk for Kai Lund' })).toHaveFocus();
  });

  it('saves one change per person, however many fields were filled for them', async () => {
    const user = fast();
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<MissingDetails state={state} onSave={onSave} />);
    await fillAll();
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
    // What was filled is no longer missing: Lena is done, Nadia still waits.
    expect(screen.queryByRole('combobox', { name: 'Cost centre for Lena Moreau' })).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Cost centre for Nadia Petrova' }),
    ).toBeInTheDocument();
  });

  it('keeps the edits and says why when the save is refused', async () => {
    const user = fast();
    render(
      <MissingDetails
        state={state}
        onSave={() => Promise.resolve({ ok: false, message: 'ENG-201 was retired' })}
      />,
    );
    await fillAll();
    await pick('Cost centre for Joan Bosch', 'ENG-201');
    await user.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(await screen.findByText('ENG-201 was retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save 1 change' })).toBeEnabled();
  });

  it('counts over everybody, and scrolls on through everybody by keyset (PEO-122)', async () => {
    const onLoadMore = vi.fn((after: string) =>
      Promise.resolve(after === 'n' ? { rows: [kai], fields: [], next: null } : null),
    );
    const { container } = render(
      <MissingDetails
        state={{ ...state, hrListed: 4210, next: 'n' }}
        onSave={vi.fn()}
        onLoadMore={onLoadMore}
      />,
    );
    // The lane counts People's total over every page, not this page's three rows.
    expect(screen.getByRole('radio', { name: /^For you to fill in 4,210/ })).toBeInTheDocument();
    // No page buttons: the next people load as the end of the list nears.
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(await screen.findAllByText('Kai Lund')).not.toHaveLength(0);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(onLoadMore).toHaveBeenCalledWith('n');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('picks a person by searching People, not from a list it was handed', async () => {
    const user = fast();
    const searchPeople = vi.fn((text: string) =>
      Promise.resolve(text === 'ing' ? [{ value: 'i', label: 'Ingrid Sø' }] : []),
    );
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <MissingDetails
        state={{
          ...state,
          fields: [{ key: 'manager', label: 'Manager', options: [], person: true }],
          rows: state.rows.slice(0, 1).map((r) => ({ ...r, missing: ['manager'] })),
        }}
        onSave={onSave}
        searchPeople={searchPeople}
      />,
    );
    await fillAll();
    await user.click(screen.getByRole('textbox', { name: 'Manager for Lena Moreau' }));
    await user.type(
      screen.getByRole('combobox', { name: 'Manager for Lena Moreau search' }),
      'ing',
    );
    await user.click(await screen.findByRole('option', { name: 'Ingrid Sø' }));
    expect(searchPeople).toHaveBeenLastCalledWith('ing');
    await user.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(onSave).toHaveBeenCalledWith([{ personId: 'l', values: { manager: 'i' } }]);
  });

  it('says so when nothing is missing, as Review’s own chip (E13)', async () => {
    const { container } = render(
      <MissingDetails state={{ ...state, fields: [], rows: [] }} onSave={vi.fn()} />,
    );
    expect(screen.getByText('Nothing is missing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fill in for all' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('is Review’s Missing details chip, and opens the grid a link named (E6, E7)', () => {
    renderReview({ completeness: state }, { kind: 'missing', fill: 'all', onFillChange: vi.fn() });
    expect(screen.getByRole('heading', { name: 'Fill in for HR' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: /^Cost centre for / })).toHaveLength(3);
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
    const { container } = render(<MissingDetails state={nif} onSave={onSave} onCheck={onCheck} />);
    await fillAll();
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
      await screen.findByText(/1 value our checks doubted went to HR’s review/),
    ).toBeInTheDocument();
  });

  it('warns on a doubted identifier in the dialog too, then saves it anyway (PEO-125)', async () => {
    const user = fast();
    const nif: CompletenessState = {
      ...state,
      fields: [
        { key: 'es_nif', label: 'NIF', dataType: 'national_id', options: [], person: false },
      ],
      rows: [{ ...(state.rows[1] as GapRow), missing: ['es_nif'] }],
    };
    const finding = {
      personId: 'j',
      key: 'es_nif',
      label: 'NIF',
      level: 'mismatch' as const,
      code: 'check_mismatch',
      message: 'The control letter does not compute.',
      review: 'none' as const,
    };
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <MissingDetails
        state={nif}
        onSave={onSave}
        onCheck={() => Promise.resolve({ ok: true as const, findings: [finding] })}
      />,
    );
    await fillIn('Joan Bosch');
    const dialog = screen.getByRole('dialog', { name: 'Fill in for Joan Bosch' });
    await user.type(within(dialog).getByRole('textbox', { name: 'NIF' }), '12345678A');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Our checks suggest this may be wrong')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save anyway' }));
    expect(onSave).toHaveBeenCalledWith([{ personId: 'j', values: { es_nif: '12345678A' } }]);
  });
});

describe('Missing details, the figures and reminders (E6, MA E5)', () => {
  it('shows one figure, how complete the records are, and what blocks payroll', () => {
    render(<MissingDetails state={state} onSave={vi.fn()} view={employees} />);
    expect(screen.getByRole('progressbar', { name: 'Records complete' })).toBeInTheDocument();
    expect(screen.getByText('79% complete')).toBeInTheDocument();
    expect(screen.getByText('4 block payroll')).toBeInTheDocument();
    expect(screen.getByText(/last 21 Sept?\.$/)).toBeInTheDocument();
  });

  it('shows no figure People could not give, rather than a zero', () => {
    render(<MissingDetails state={{ ...state, blocking: null }} onSave={vi.fn()} />);
    expect(screen.queryByText(/block payroll/)).toBeNull();
    expect(screen.getByText('79% complete')).toBeInTheDocument();
  });

  it('reminds everybody due at once, and says who was not due', async () => {
    const onRemindAll = vi.fn(() =>
      Promise.resolve({ ok: true as const, sent: 40, failed: 0, skipped: 21 }),
    );
    const { container } = render(
      <MissingDetails state={state} onSave={vi.fn()} onRemindAll={onRemindAll} view={employees} />,
    );
    await fast().click(screen.getByRole('button', { name: 'Remind 61 people waiting' }));
    expect(onRemindAll).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(/Sent 40 reminders\. 21 people were not due/),
    ).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers no bulk reminder when nobody is due, or it cannot be sent from here', () => {
    const { rerender } = render(
      <MissingDetails
        state={{ ...state, waiting: { ...state.waiting, due: 0 } }}
        onSave={vi.fn()}
        onRemindAll={vi.fn()}
        view={employees}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Remind \d/ })).toBeNull();
    rerender(<MissingDetails state={state} onSave={vi.fn()} view={employees} />);
    expect(screen.queryByRole('button', { name: /^Remind \d/ })).toBeNull();
  });

  it('reminds one person of their own fields, and not twice in a day', async () => {
    const onRemind = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <MissingDetails
        state={{
          ...state,
          rows: state.rows.map((r) =>
            r.personId === 'u' ? { ...r, remindedAt: new Date().toISOString() } : r,
          ),
        }}
        now={Date.now()}
        onSave={vi.fn()}
        onRemind={onRemind}
        view={employees}
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
    render(<MissingDetails state={state} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Fill in Omar Haddad' })).toBeNull();
    await fillAll();
    expect(screen.queryByRole('textbox', { name: /Bank account/ })).toBeNull();
    expect(screen.queryByText('Omar Haddad')).toBeNull();
  });
});

describe('grouped', () => {
  const labelOf = (key: string): string => key;
  const heads = (by: Parameters<typeof grouped>[1]) =>
    grouped(state.rows, by, labelOf).flatMap((e) =>
      e.kind === 'head' ? [`${e.label} ${String(e.count)}`] : [],
    );

  it('lists the rows as they are, ungrouped', () => {
    expect(grouped(state.rows, 'none', labelOf)).toHaveLength(state.rows.length);
  });

  it('puts teams and managers in order, the people without one last', () => {
    expect(heads('team')).toEqual(['Design 1', 'Engineering 2', 'Sales 2']);
    expect(heads('manager')).toEqual(['Ingrid Sø 1', 'Tomás Oliveira 2', 'No manager 2']);
  });

  it('puts a person under every field they lack, the largest group first', () => {
    expect(heads('field')).toEqual([
      'cost_centre 3',
      'desk 1',
      'emergency_contact 1',
      'iban 1',
    ]);
    // Lena twice, under each, and each row keyed apart.
    const keys = grouped(state.rows, 'field', labelOf).map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
